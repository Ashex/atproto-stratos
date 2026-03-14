import { Kysely } from 'kysely'
import { WebSocket } from 'ws'
import { subsystemLogger } from '@atproto/common'
import { Keypair } from '@atproto/crypto'
import { Frame } from '@atproto/xrpc-server'
import { DatabaseSchemaType } from '../data-plane/server/db/database-schema'
import { createStratosSyncToken } from './auth'
import { deleteStratosRecord, indexStratosRecord } from './record-indexer'
import { StratosStore } from './store'

const logger = subsystemLogger('bsky:stratos-indexer')

const STRATOS_POST_COLLECTION = 'zone.stratos.feed.post'

export interface StratosIndexerConfig {
  stratosServiceUrl: string
  stratosServiceDid: string
  appviewDid: string
  signingKey: Keypair
}

interface CommitMessage {
  seq: number
  did: string
  time: string
  rev: string
  ops: RecordOp[]
}

interface RecordOp {
  action: 'create' | 'update' | 'delete'
  path: string
  cid?: string
  record?: Record<string, unknown>
}

interface EnrollmentMessage {
  did: string
  action: string
  service?: string
  boundaries: string[]
  time: string
}

export class StratosIndexer {
  private actorSubscriptions = new Map<string, WebSocket>()
  private actorReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private serviceWs: WebSocket | null = null
  private serviceReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(
    private db: Kysely<DatabaseSchemaType>,
    private store: StratosStore,
    private config: StratosIndexerConfig,
  ) {}

  async start(): Promise<void> {
    this.running = true
    logger.info('starting stratos indexer')

    this.connectServiceSubscription()

    const enrollments = await this.db
      .selectFrom('stratos_enrollment')
      .select(['did', 'serviceUrl'])
      .execute()

    for (const enrollment of enrollments) {
      void this.subscribeActor(enrollment.did)
    }

    logger.info({ count: enrollments.length }, 'subscribed to enrolled actors')
  }

  async stop(): Promise<void> {
    this.running = false

    if (this.serviceReconnectTimer) {
      clearTimeout(this.serviceReconnectTimer)
      this.serviceReconnectTimer = null
    }
    if (this.serviceWs) {
      this.serviceWs.close()
      this.serviceWs = null
    }

    for (const [, timer] of this.actorReconnectTimers) {
      clearTimeout(timer)
    }
    this.actorReconnectTimers.clear()

    for (const [, ws] of this.actorSubscriptions) {
      ws.close()
    }
    this.actorSubscriptions.clear()

    logger.info('stopped stratos indexer')
  }

  async addActor(did: string): Promise<void> {
    if (this.actorSubscriptions.has(did)) return
    await this.subscribeActor(did)
  }

  removeActor(did: string): void {
    const ws = this.actorSubscriptions.get(did)
    if (ws) {
      ws.close()
      this.actorSubscriptions.delete(did)
    }
    const timer = this.actorReconnectTimers.get(did)
    if (timer) {
      clearTimeout(timer)
      this.actorReconnectTimers.delete(did)
    }
  }

  // Service-level enrollment stream — discovers new actors in real time

  private async connectServiceSubscription(attempt = 0): Promise<void> {
    if (!this.running) return

    const token = await createStratosSyncToken(
      this.config.signingKey,
      this.config.appviewDid,
      this.config.stratosServiceDid,
      'zone.stratos.sync.subscribeRecords',
    )

    const wsUrl = new URL(
      '/xrpc/zone.stratos.sync.subscribeRecords',
      this.config.stratosServiceUrl.replace(/^http/, 'ws'),
    )
    wsUrl.searchParams.set('syncToken', token)

    const ws = new WebSocket(wsUrl.toString())
    this.serviceWs = ws

    ws.addEventListener('message', (event) => {
      void this.handleServiceMessage(event.data)
    })

    ws.addEventListener('open', () => {
      logger.info('service enrollment stream connected')
    })

    ws.addEventListener('close', () => {
      this.serviceWs = null
      this.scheduleServiceReconnect(attempt)
    })

    ws.addEventListener('error', (err) => {
      logger.warn({ err }, 'service enrollment stream error')
    })
  }

  private scheduleServiceReconnect(attempt: number): void {
    if (!this.running) return

    const delay = Math.min(1000 * Math.pow(2, attempt), 60_000)
    this.serviceReconnectTimer = setTimeout(() => {
      this.serviceReconnectTimer = null
      void this.connectServiceSubscription(attempt + 1)
    }, delay)
  }

  private async handleServiceMessage(data: unknown): Promise<void> {
    try {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : Buffer.from(data as Buffer)

      const frame = Frame.fromBytes(bytes)
      if (!frame.isMessage()) return

      const frameType = frame.type ?? ''

      if (!frameType.endsWith('#enrollment')) return

      const body = frame.body as unknown as EnrollmentMessage
      const { did, action, boundaries = [] } = body

      if (action === 'enroll') {
        logger.info({ did, boundaries }, 'enrollment discovered via stream')

        await this.store.upsertEnrollment({
          did,
          serviceUrl: this.config.stratosServiceUrl,
          enrolledAt: body.time ?? new Date().toISOString(),
          boundaries,
        })

        await this.addActor(did)
      } else if (action === 'unenroll') {
        logger.info({ did }, 'unenrollment discovered via stream')
        this.removeActor(did)
      }
    } catch (err) {
      logger.error({ err }, 'failed to process service enrollment message')
    }
  }

  // Per-actor record subscriptions

  private async subscribeActor(did: string, attempt = 0): Promise<void> {
    if (!this.running) return

    const cursor = await this.store.getSyncCursor(did)
    const token = await createStratosSyncToken(
      this.config.signingKey,
      this.config.appviewDid,
      this.config.stratosServiceDid,
      'zone.stratos.sync.subscribeRecords',
    )

    const wsUrl = new URL(
      '/xrpc/zone.stratos.sync.subscribeRecords',
      this.config.stratosServiceUrl.replace(/^http/, 'ws'),
    )
    wsUrl.searchParams.set('did', did)
    if (cursor !== null) {
      wsUrl.searchParams.set('cursor', String(cursor))
    }
    wsUrl.searchParams.set('syncToken', token)

    const ws = new WebSocket(wsUrl.toString())
    this.actorSubscriptions.set(did, ws)

    ws.addEventListener('message', (event) => {
      void this.handleActorMessage(did, event.data)
    })

    ws.addEventListener('open', () => {
      logger.debug({ did }, 'actor sync stream connected')
    })

    ws.addEventListener('close', () => {
      this.actorSubscriptions.delete(did)
      this.scheduleActorReconnect(did, attempt)
    })

    ws.addEventListener('error', (err) => {
      logger.warn({ did, err }, 'actor sync stream error')
    })
  }

  private scheduleActorReconnect(did: string, attempt: number): void {
    if (!this.running) return

    const delay = Math.min(1000 * Math.pow(2, attempt), 60_000)
    const timer = setTimeout(() => {
      this.actorReconnectTimers.delete(did)
      void this.subscribeActor(did, attempt + 1)
    }, delay)
    this.actorReconnectTimers.set(did, timer)
  }

  private async handleActorMessage(did: string, data: unknown): Promise<void> {
    try {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : Buffer.from(data as Buffer)

      const frame = Frame.fromBytes(bytes)
      if (!frame.isMessage()) return

      const frameType = frame.type ?? ''
      const body = frame.body as Record<string, unknown>

      if (frameType.endsWith('#info')) {
        const name = body.name as string | undefined
        if (name === 'OutdatedCursor') {
          logger.info({ did }, 'outdated cursor, need full repo import')
        }
        return
      }

      if (frameType.endsWith('#commit')) {
        const commit = body as unknown as CommitMessage
        await this.processCommit(did, commit)
      }
    } catch (err) {
      logger.error({ did, err }, 'failed to process actor sync message')
    }
  }

  private async processCommit(
    did: string,
    commit: CommitMessage,
  ): Promise<void> {
    for (const op of commit.ops) {
      const trimmedPath = op.path.replace(/^\//, '')
      const collection = trimmedPath.split('/')[0]
      if (collection !== STRATOS_POST_COLLECTION) continue

      const uri = `at://${did}/${trimmedPath}`

      if (op.action === 'create' || op.action === 'update') {
        if (op.record) {
          await indexStratosRecord(
            this.db,
            uri,
            op.cid ?? '',
            op.record,
            commit.time,
          )
        }
      } else if (op.action === 'delete') {
        await deleteStratosRecord(this.db, uri)
      }
    }

    await this.store.updateSyncCursor(did, commit.seq)
  }
}
