import events from 'node:events'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import compression from 'compression'
import cors from 'cors'
import { Etcd3 } from 'etcd3'
import express from 'express'
import { HttpTerminator, createHttpTerminator } from 'http-terminator'
import { AtpAgent } from '@atproto/api'
import { DAY, SECOND } from '@atproto/common'
import { Keypair } from '@atproto/crypto'
import { IdResolver } from '@atproto/identity'
import API, { blobResolver, external, health, sitemap, wellKnown } from './api'
import { createBlobDispatcher } from './api/blob-dispatcher'
import { AuthVerifier, createPublicKeyObject } from './auth-verifier'
import { authWithApiKey as bsyncAuth, createBsyncClient } from './bsync'
import { ServerConfig } from './config'
import { AppContext } from './context'
import { authWithApiKey as courierAuth, createCourierClient } from './courier'
import {
  BasicHostList,
  EtcdHostList,
  createDataPlaneClient,
} from './data-plane/client'
import { Database } from './data-plane/server/db'
import * as error from './error'
import { FeatureGates } from './feature-gates'
import { Hydrator } from './hydration/hydrator'
import * as imageServer from './image/server'
import { ImageUriBuilder } from './image/uri'
import { createKwsClient } from './kws'
import { createServer } from './lexicon'
import { loggerMiddleware } from './logger'
import { authWithApiKey as rolodexAuth, createRolodexClient } from './rolodex'
import { createStashClient } from './stash'
import { StratosStore } from './stratos/store'
import { StratosEnrollmentManager } from './stratos/enrollment-manager'
import { StratosIndexer } from './stratos/indexer'
import { Views } from './views'
import { VideoUriBuilder } from './views/util'

export { ServerConfig } from './config'
export type { ServerConfigValues } from './config'
export { AppContext } from './context'
export * from './data-plane'
export { BackgroundQueue } from './data-plane/server/background'
export { Database } from './data-plane/server/db'
export { Redis } from './redis'

export class BskyAppView {
  public ctx: AppContext
  public app: express.Application
  public server?: http.Server
  private terminator?: HttpTerminator
  private stratosDb?: Database

  constructor(opts: { ctx: AppContext; app: express.Application; stratosDb?: Database }) {
    this.ctx = opts.ctx
    this.app = opts.app
    this.stratosDb = opts.stratosDb
  }

  static create(opts: {
    config: ServerConfig
    signingKey: Keypair
  }): BskyAppView {
    const { config, signingKey } = opts
    const app = express()
    app.set('trust proxy', true)
    // Configure query parser to handle arrays with > 20 items
    // Default Express/qs has arrayLimit of 20 which causes arrays to become objects
    app.set('query parser', (str: string) => {
      const result: Record<string, string | string[]> = Object.create(null)
      if (!str) return result
      const searchParams = new URLSearchParams(str)
      for (const key of searchParams.keys()) {
        const values = searchParams.getAll(key)
        result[key] = values.length === 1 ? values[0] : values
      }
      return result
    })
    app.use(
      cors({
        origin: true,
        credentials: true,
        maxAge: DAY / SECOND,
        exposedHeaders: ['DPoP-Nonce', 'WWW-Authenticate'],
      }),
    )
    app.use(loggerMiddleware)
    app.use(compression())

    // used solely for handle resolution: identity lookups occur on dataplane
    const idResolver = new IdResolver({
      plcUrl: config.didPlcUrl,
      backupNameservers: config.handleResolveNameservers,
    })

    const imgUriBuilder = new ImageUriBuilder(
      config.cdnUrl || `${config.publicUrl}/img`,
    )
    const videoUriBuilder = new VideoUriBuilder({
      playlistUrlPattern:
        config.videoPlaylistUrlPattern ||
        `${config.publicUrl}/vid/%s/%s/playlist.m3u8`,
      thumbnailUrlPattern:
        config.videoThumbnailUrlPattern ||
        `${config.publicUrl}/vid/%s/%s/thumbnail.jpg`,
    })

    const searchAgent = config.searchUrl
      ? new AtpAgent({ service: config.searchUrl })
      : undefined

    const suggestionsAgent = config.suggestionsUrl
      ? new AtpAgent({ service: config.suggestionsUrl })
      : undefined
    if (suggestionsAgent && config.suggestionsApiKey) {
      suggestionsAgent.api.setHeader(
        'authorization',
        `Bearer ${config.suggestionsApiKey}`,
      )
    }

    const topicsAgent = config.topicsUrl
      ? new AtpAgent({ service: config.topicsUrl })
      : undefined
    if (topicsAgent && config.topicsApiKey) {
      topicsAgent.api.setHeader(
        'authorization',
        `Bearer ${config.topicsApiKey}`,
      )
    }

    const etcd = config.etcdHosts.length
      ? new Etcd3({ hosts: config.etcdHosts })
      : undefined

    const dataplaneHostList =
      etcd && config.dataplaneUrlsEtcdKeyPrefix
        ? new EtcdHostList(
            etcd,
            config.dataplaneUrlsEtcdKeyPrefix,
            config.dataplaneUrls,
          )
        : new BasicHostList(config.dataplaneUrls)

    const dataplane = createDataPlaneClient(dataplaneHostList, {
      httpVersion: config.dataplaneHttpVersion,
      rejectUnauthorized: !config.dataplaneIgnoreBadTls,
    })
    const hydrator = new Hydrator(dataplane, config.labelsFromIssuerDids, {
      debugFieldAllowedDids: config.debugFieldAllowedDids,
    })
    const views = new Views({
      imgUriBuilder: imgUriBuilder,
      videoUriBuilder: videoUriBuilder,
      indexedAtEpoch: config.indexedAtEpoch,
      threadTagsBumpDown: [...config.threadTagsBumpDown],
      threadTagsHide: [...config.threadTagsHide],
      visibilityTagHide: config.visibilityTagHide,
      visibilityTagRankPrefix: config.visibilityTagRankPrefix,
    })

    const bsyncClient = createBsyncClient({
      baseUrl: config.bsyncUrl,
      httpVersion: config.bsyncHttpVersion ?? '2',
      nodeOptions: { rejectUnauthorized: !config.bsyncIgnoreBadTls },
      interceptors: config.bsyncApiKey ? [bsyncAuth(config.bsyncApiKey)] : [],
    })

    const stashClient = createStashClient(bsyncClient)

    const courierClient = config.courierUrl
      ? createCourierClient({
          baseUrl: config.courierUrl,
          httpVersion: config.courierHttpVersion ?? '2',
          nodeOptions: { rejectUnauthorized: !config.courierIgnoreBadTls },
          interceptors: config.courierApiKey
            ? [courierAuth(config.courierApiKey)]
            : [],
        })
      : undefined

    const rolodexClient = config.rolodexUrl
      ? createRolodexClient({
          baseUrl: config.rolodexUrl,
          httpVersion: config.rolodexHttpVersion ?? '2',
          nodeOptions: { rejectUnauthorized: !config.rolodexIgnoreBadTls },
          interceptors: config.rolodexApiKey
            ? [rolodexAuth(config.rolodexApiKey)]
            : [],
        })
      : undefined

    const kwsClient = config.kws ? createKwsClient(config.kws) : undefined

    const entrywayJwtPublicKey = config.entrywayJwtPublicKeyHex
      ? createPublicKeyObject(config.entrywayJwtPublicKeyHex)
      : undefined
    const authVerifier = new AuthVerifier(dataplane, {
      ownDid: config.serverDid,
      alternateAudienceDids: config.alternateAudienceDids,
      modServiceDid: config.modServiceDid,
      adminPasses: config.adminPasswords,
      entrywayJwtPublicKey,
      idResolver,
    })

    const featureGates = new FeatureGates({
      apiHost: config.growthBookApiHost,
      clientKey: config.growthBookClientKey,
    })

    const blobDispatcher = createBlobDispatcher(config)

    let stratosStore: StratosStore | undefined
    let stratosEnrollmentManager: StratosEnrollmentManager | undefined
    let stratosIndexer: StratosIndexer | undefined
    let stratosDb: Database | undefined

    if (config.stratosDbUrl && config.stratosServiceUrl && config.stratosServiceDid) {
      console.log('[stratos] Initializing Stratos integration', {
        serviceUrl: config.stratosServiceUrl,
        serviceDid: config.stratosServiceDid,
        dbSchema: config.stratosDbSchema,
        syncEnabled: config.stratosSyncEnabled,
      })
      stratosDb = new Database({
        url: config.stratosDbUrl,
        schema: config.stratosDbSchema,
        poolSize: 5,
      })
      stratosStore = new StratosStore(stratosDb.db)
      stratosEnrollmentManager = new StratosEnrollmentManager(stratosStore, {
        stratosServiceUrl: config.stratosServiceUrl,
        stratosServiceDid: config.stratosServiceDid,
        appviewDid: config.serverDid,
        signingKey,
        refreshIntervalMs: 5 * 60 * 1000,
      })
      if (config.stratosSyncEnabled) {
        stratosIndexer = new StratosIndexer(
          stratosDb.db,
          stratosStore,
          {
            stratosServiceUrl: config.stratosServiceUrl,
            stratosServiceDid: config.stratosServiceDid,
            appviewDid: config.serverDid,
            signingKey,
          },
        )
        stratosEnrollmentManager.setActorSubscriber(stratosIndexer)
      }
    } else {
      console.log('[stratos] Stratos integration NOT initialized', {
        hasDbUrl: !!config.stratosDbUrl,
        hasServiceUrl: !!config.stratosServiceUrl,
        hasServiceDid: !!config.stratosServiceDid,
      })
    }

    const ctx = new AppContext({
      cfg: config,
      etcd,
      dataplane,
      dataplaneHostList,
      searchAgent,
      suggestionsAgent,
      topicsAgent,
      hydrator,
      views,
      signingKey,
      idResolver,
      bsyncClient,
      stashClient,
      courierClient,
      rolodexClient,
      authVerifier,
      featureGates,
      blobDispatcher,
      kwsClient,
      stratosStore,
      stratosEnrollmentManager,
      stratosIndexer,
    })

    let server = createServer({
      validateResponse: config.debugMode,
      payload: {
        jsonLimit: 100 * 1024, // 100kb
        textLimit: 100 * 1024, // 100kb
        blobLimit: 5 * 1024 * 1024, // 5mb
      },
    })

    server = API(server, ctx)

    app.use(health.createRouter(ctx))
    app.use(wellKnown.createRouter(ctx))
    app.use(blobResolver.createMiddleware(ctx))
    app.use(imageServer.createMiddleware(ctx, { prefix: '/img/' }))

    if (config.dataplaneUrls.length > 0 || config.dataplaneUrlsEtcdKeyPrefix) {
      app.use(sitemap.createRouter(ctx))
    }

    app.use(server.xrpc.router)
    app.use(error.handler)
    app.use('/external', external.createRouter(ctx))

    return new BskyAppView({ ctx, app, stratosDb })
  }

  async start(): Promise<http.Server> {
    if (this.ctx.dataplaneHostList instanceof EtcdHostList) {
      await this.ctx.dataplaneHostList.connect()
    }
    await this.ctx.featureGates.start()
    if (this.ctx.stratosEnrollmentManager) {
      this.ctx.stratosEnrollmentManager.start()
    }
    if (this.ctx.stratosIndexer) {
      await this.ctx.stratosIndexer.start()
    }
    const server = this.app.listen(this.ctx.cfg.port)
    this.server = server
    server.keepAliveTimeout = 90000
    this.terminator = createHttpTerminator({ server })
    await events.once(server, 'listening')
    const { port } = server.address() as AddressInfo
    this.ctx.cfg.assignPort(port)
    return server
  }

  async destroy(): Promise<void> {
    if (this.ctx.stratosIndexer) {
      await this.ctx.stratosIndexer.stop()
    }
    if (this.ctx.stratosEnrollmentManager) {
      this.ctx.stratosEnrollmentManager.stop()
    }
    this.ctx.featureGates.destroy()
    await this.terminator?.terminate()
    await this.ctx.etcd?.close()
    if (this.stratosDb) {
      await this.stratosDb.close()
    }
  }
}

export default BskyAppView
