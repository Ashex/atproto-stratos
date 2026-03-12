import { Kysely } from 'kysely'
import { WebSocket } from 'ws'
import { subsystemLogger } from '@atproto/common'
import { Keypair } from '@atproto/crypto'
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

export class StratosIndexer {
  private subscriptions = new Map<string, WebSocket>()
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private running = false

  constructor(
    private db: Kysely<DatabaseSchemaType>,
    private store: StratosStore,
    private config: StratosIndexerConfig,
  ) {}

  async start(): Promise<void> {
    this.running = true
    logger.info('starting stratos indexer')

    // Load all enrolled actors and subscribe to each
    const enrollments = await this.db
      .selectFrom('stratos_enrollment')
      .select(['did', 'serviceUrl'])
      .execute()

    for (const enrollment of enrollments) {
      void this.subscribe(enrollment.did)
    }

    logger.info({ count: enrollments.length }, 'subscribed to enrolled actors')
  }

  async stop(): Promise<void> {
    this.running = false

    for (const [did, timer] of this.reconnectTimers) {
      clearTimeout(timer)
    }
    this.reconnectTimers.clear()

    for (const [did, ws] of this.subscriptions) {
      ws.close()
    }
    this.subscriptions.clear()

    logger.info('stopped stratos indexer')
  }

  async addActor(did: string): Promise<void> {
    if (this.subscriptions.has(did)) return
    await this.subscribe(did)
  }

  removeActor(did: string): void {
    const ws = this.subscriptions.get(did)
    if (ws) {
      ws.close()
      this.subscriptions.delete(did)
    }
    const timer = this.reconnectTimers.get(did)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(did)
    }
  }

  private async subscribe(did: string, attempt = 0): Promise<void> {
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
    this.subscriptions.set(did, ws)

    ws.addEventListener('message', (event) => {
      void this.handleMessage(did, event.data)
    })

    ws.addEventListener('open', () => {
      logger.debug({ did }, 'sync stream connected')
    })

    ws.addEventListener('close', () => {
      this.subscriptions.delete(did)
      this.scheduleReconnect(did, attempt)
    })

    ws.addEventListener('error', (err) => {
      logger.warn({ did, err }, 'sync stream error')
    })
  }

  private scheduleReconnect(did: string, attempt: number): void {
    if (!this.running) return

    const delay = Math.min(1000 * Math.pow(2, attempt), 60_000)
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(did)
      void this.subscribe(did, attempt + 1)
    }, delay)
    this.reconnectTimers.set(did, timer)
  }

  private async handleMessage(did: string, data: unknown): Promise<void> {
    try {
      const text =
        typeof data === 'string'
          ? data
          : Buffer.from(data as ArrayBuffer).toString()
      const msg = JSON.parse(text) as { $type?: string } & Record<
        string,
        unknown
      >

      if (msg.$type === '#info') {
        const name = msg.name as string | undefined
        if (name === 'OutdatedCursor') {
          logger.info({ did }, 'outdated cursor, need full repo import')
          // TODO: trigger full repo import via zone.stratos.sync.getRepo
        }
        return
      }

      if (msg.$type === '#commit') {
        const commit = msg as unknown as CommitMessage
        await this.processCommit(did, commit)
      }
    } catch (err) {
      logger.error({ did, err }, 'failed to process sync message')
    }
  }

  private async processCommit(
    did: string,
    commit: CommitMessage,
  ): Promise<void> {
    for (const op of commit.ops) {
      const collection = op.path.split('/')[0]
      if (collection !== STRATOS_POST_COLLECTION) continue

      const uri = `at://${did}/${op.path}`

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
