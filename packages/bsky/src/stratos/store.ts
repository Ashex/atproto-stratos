import { Kysely, sql } from 'kysely'
import { DatabaseSchemaType } from '../data-plane/server/db/database-schema'

export interface StratosTimelineParams {
  viewerBoundaries: string[]
  limit: number
  cursor?: string
}

export interface StratosAuthorFeedParams {
  actorDid: string
  viewerBoundaries: string[]
  boundary?: string
  limit: number
  cursor?: string
}

export interface StratosPostRow {
  uri: string
  cid: string
  rkey: string
  creator: string
  text: string
  replyRoot: string | null
  replyRootCid: string | null
  replyParent: string | null
  replyParentCid: string | null
  embed: string | null
  facets: string | null
  langs: string | null
  labels: string | null
  tags: string | null
  createdAt: string
  indexedAt: string
  sortAt: string
}

export interface StratosPostWithBoundaries extends StratosPostRow {
  boundaries: string[]
}

export class StratosStore {
  constructor(private db: Kysely<DatabaseSchemaType>) {}

  async getPost(uri: string): Promise<StratosPostWithBoundaries | null> {
    const post = await this.db
      .selectFrom('stratos_post')
      .selectAll()
      .where('uri', '=', uri)
      .executeTakeFirst()

    if (!post) return null

    const boundaries = await this.db
      .selectFrom('stratos_post_boundary')
      .select('boundary')
      .where('uri', '=', uri)
      .execute()

    return {
      ...post,
      sortAt: post.sortAt as string,
      boundaries: boundaries.map((b) => b.boundary),
    }
  }

  async getTimeline(
    params: StratosTimelineParams,
  ): Promise<{ posts: StratosPostRow[]; cursor?: string }> {
    const { viewerBoundaries, limit, cursor } = params

    if (viewerBoundaries.length === 0) {
      return { posts: [] }
    }

    let query = this.db
      .selectFrom('stratos_post')
      .selectAll()
      .whereExists((qb) =>
        qb
          .selectFrom('stratos_post_boundary')
          .select(sql`1`.as('one'))
          .whereRef('stratos_post_boundary.uri', '=', 'stratos_post.uri')
          .where('stratos_post_boundary.boundary', 'in', viewerBoundaries),
      )
      .orderBy('sortAt', 'desc')
      .limit(limit + 1)

    if (cursor) {
      query = query.where('sortAt', '<', cursor)
    }

    const rows = await query.execute()

    const hasMore = rows.length > limit
    const posts = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? posts[posts.length - 1]?.sortAt : undefined

    return {
      posts: posts as StratosPostRow[],
      cursor: nextCursor,
    }
  }

  async getAuthorFeed(
    params: StratosAuthorFeedParams,
  ): Promise<{ posts: StratosPostRow[]; cursor?: string }> {
    const { actorDid, viewerBoundaries, boundary, limit, cursor } = params

    if (viewerBoundaries.length === 0) {
      return { posts: [] }
    }

    const boundariesToCheck = boundary
      ? [boundary]
      : viewerBoundaries

    let query = this.db
      .selectFrom('stratos_post')
      .selectAll()
      .where('creator', '=', actorDid)
      .whereExists((qb) =>
        qb
          .selectFrom('stratos_post_boundary')
          .select(sql`1`.as('one'))
          .whereRef('stratos_post_boundary.uri', '=', 'stratos_post.uri')
          .where('stratos_post_boundary.boundary', 'in', boundariesToCheck),
      )
      .orderBy('sortAt', 'desc')
      .limit(limit + 1)

    if (cursor) {
      query = query.where('sortAt', '<', cursor)
    }

    const rows = await query.execute()

    const hasMore = rows.length > limit
    const posts = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? posts[posts.length - 1]?.sortAt : undefined

    return {
      posts: posts as StratosPostRow[],
      cursor: nextCursor,
    }
  }

  async getPostBoundaries(uri: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('stratos_post_boundary')
      .select('boundary')
      .where('uri', '=', uri)
      .execute()
    return rows.map((r) => r.boundary)
  }

  async getBoundariesForPosts(
    uris: string[],
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>()
    if (uris.length === 0) return result

    const rows = await this.db
      .selectFrom('stratos_post_boundary')
      .select(['uri', 'boundary'])
      .where('uri', 'in', uris)
      .execute()

    for (const row of rows) {
      const existing = result.get(row.uri)
      if (existing) {
        existing.push(row.boundary)
      } else {
        result.set(row.uri, [row.boundary])
      }
    }
    return result
  }

  async getEnrollment(did: string) {
    return this.db
      .selectFrom('stratos_enrollment')
      .selectAll()
      .where('did', '=', did)
      .executeTakeFirst()
  }

  async isEnrolled(did: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('stratos_enrollment')
      .select('did')
      .where('did', '=', did)
      .executeTakeFirst()
    return !!row
  }

  async getBoundaries(did: string): Promise<string[]> {
    const enrollment = await this.getEnrollment(did)
    if (!enrollment?.boundaries) return []
    return JSON.parse(enrollment.boundaries) as string[]
  }

  async getAllEnrollments(): Promise<Array<{ did: string; serviceUrl: string }>> {
    return this.db
      .selectFrom('stratos_enrollment')
      .select(['did', 'serviceUrl'])
      .execute()
  }

  async upsertEnrollment(enrollment: {
    did: string
    serviceUrl: string
    enrolledAt: string
    boundaries: string[]
  }): Promise<void> {
    await this.db
      .insertInto('stratos_enrollment')
      .values({
        did: enrollment.did,
        serviceUrl: enrollment.serviceUrl,
        enrolledAt: enrollment.enrolledAt,
        lastChecked: new Date().toISOString(),
        boundaries: JSON.stringify(enrollment.boundaries),
      })
      .onConflict((oc) =>
        oc.column('did').doUpdateSet({
          serviceUrl: enrollment.serviceUrl,
          lastChecked: new Date().toISOString(),
          boundaries: JSON.stringify(enrollment.boundaries),
        }),
      )
      .execute()
  }

  async getSyncCursor(did: string): Promise<number | null> {
    const row = await this.db
      .selectFrom('stratos_sync_cursor')
      .select('seq')
      .where('did', '=', did)
      .executeTakeFirst()
    return row?.seq ?? null
  }

  async updateSyncCursor(did: string, seq: number): Promise<void> {
    await this.db
      .insertInto('stratos_sync_cursor')
      .values({
        did,
        seq,
        updatedAt: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc.column('did').doUpdateSet({
          seq,
          updatedAt: new Date().toISOString(),
        }),
      )
      .execute()
  }
}
