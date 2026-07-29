import { Kysely } from 'kysely'
import { DatabaseSchemaType } from '../data-plane/server/db/database-schema'

function extractBoundaries(record: Record<string, unknown>): string[] {
  const boundary = record.boundary as
    | { values?: Array<{ value?: string }> }
    | undefined
  if (!boundary?.values || !Array.isArray(boundary.values)) return []
  return boundary.values
    .map((d) => d.value)
    .filter((v): v is string => typeof v === 'string')
}

function preparePostRow(
  uri: string,
  cid: string,
  record: Record<string, unknown>,
  timestamp: string,
) {
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

  return {
    row: {
      uri,
      cid,
      rkey,
      creator,
      text,
      replyRoot: replyRef?.root?.uri ?? null,
      replyRootCid: replyRef?.root?.cid ?? null,
      replyParent: replyRef?.parent?.uri ?? null,
      replyParentCid: replyRef?.parent?.cid ?? null,
      embed: record.embed ? JSON.stringify(record.embed) : null,
      facets: record.facets ? JSON.stringify(record.facets) : null,
      langs: Array.isArray(record.langs)
        ? (record.langs as string[]).join(',')
        : null,
      labels: record.labels ? JSON.stringify(record.labels) : null,
      tags: Array.isArray(record.tags)
        ? (record.tags as string[]).join(',')
        : null,
      createdAt,
      indexedAt: timestamp,
    },
    boundaries: extractBoundaries(record),
  }
}

export async function indexStratosRecord(
  db: Kysely<DatabaseSchemaType>,
  uri: string,
  cid: string,
  record: Record<string, unknown>,
  timestamp: string,
): Promise<void> {
  const { row, boundaries } = preparePostRow(uri, cid, record, timestamp)

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('stratos_post')
      .values(row)
      .onConflict((oc) =>
        oc.column('uri').doUpdateSet({
          cid: row.cid,
          text: row.text,
          replyRoot: row.replyRoot,
          replyRootCid: row.replyRootCid,
          replyParent: row.replyParent,
          replyParentCid: row.replyParentCid,
          embed: row.embed,
          facets: row.facets,
          langs: row.langs,
          labels: row.labels,
          tags: row.tags,
          indexedAt: row.indexedAt,
        }),
      )
      .execute()

    await trx
      .deleteFrom('stratos_post_boundary')
      .where('uri', '=', uri)
      .execute()

    if (boundaries.length > 0) {
      await trx
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
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom('stratos_post_boundary')
      .where('uri', '=', uri)
      .execute()
    await trx.deleteFrom('stratos_post').where('uri', '=', uri).execute()
  })
}
