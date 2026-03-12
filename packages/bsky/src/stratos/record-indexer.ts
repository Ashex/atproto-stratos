import { Kysely } from 'kysely'
import { DatabaseSchemaType } from '../data-plane/server/db/database-schema'

export async function indexStratosRecord(
  db: Kysely<DatabaseSchemaType>,
  uri: string,
  cid: string,
  record: Record<string, unknown>,
  timestamp: string,
): Promise<void> {
  const parts = uri.replace('at://', '').split('/')
  const creator = parts[0]
  const rkey = parts[2]

  const text = typeof record.text === 'string' ? record.text : ''
  const createdAt =
    typeof record.createdAt === 'string'
      ? record.createdAt
      : new Date().toISOString()

  const replyRef = record.reply as
    | {
        root?: { uri?: string; cid?: string }
        parent?: { uri?: string; cid?: string }
      }
    | undefined

  const embed = record.embed ? JSON.stringify(record.embed) : null
  const facets = record.facets ? JSON.stringify(record.facets) : null
  const labels = record.labels ? JSON.stringify(record.labels) : null
  const langs = Array.isArray(record.langs)
    ? (record.langs as string[]).join(',')
    : null
  const tags = Array.isArray(record.tags)
    ? (record.tags as string[]).join(',')
    : null

  const boundaries = extractBoundaries(record)

  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('stratos_post')
      .values({
        uri,
        cid,
        rkey,
        creator,
        text,
        replyRoot: replyRef?.root?.uri ?? null,
        replyRootCid: replyRef?.root?.cid ?? null,
        replyParent: replyRef?.parent?.uri ?? null,
        replyParentCid: replyRef?.parent?.cid ?? null,
        embed,
        facets,
        langs,
        labels,
        tags,
        createdAt,
        indexedAt: timestamp,
      })
      .onConflict((oc) =>
        oc.column('uri').doUpdateSet({
          cid,
          text,
          embed,
          facets,
          langs,
          labels,
          tags,
          indexedAt: timestamp,
        }),
      )
      .execute()

    // Replace boundaries
    await tx
      .deleteFrom('stratos_post_boundary')
      .where('uri', '=', uri)
      .execute()

    if (boundaries.length > 0) {
      await tx
        .insertInto('stratos_post_boundary')
        .values(boundaries.map((boundary) => ({ uri, boundary })))
        .execute()
    }
  })
}

export async function deleteStratosRecord(
  db: Kysely<DatabaseSchemaType>,
  uri: string,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await tx
      .deleteFrom('stratos_post_boundary')
      .where('uri', '=', uri)
      .execute()
    await tx.deleteFrom('stratos_post').where('uri', '=', uri).execute()
  })
}

function extractBoundaries(record: Record<string, unknown>): string[] {
  const boundary = record.boundary as
    | { values?: Array<{ value?: string }> }
    | undefined
  if (!boundary?.values || !Array.isArray(boundary.values)) {
    return []
  }
  return boundary.values
    .map((d) => d.value)
    .filter((v): v is string => typeof v === 'string')
}
