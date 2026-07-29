import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('stratos_post')
    .addColumn('uri', 'varchar', (col) => col.primaryKey())
    .addColumn('cid', 'varchar', (col) => col.notNull())
    .addColumn('rkey', 'varchar', (col) => col.notNull())
    .addColumn('creator', 'varchar', (col) => col.notNull())
    .addColumn('text', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('replyRoot', 'varchar')
    .addColumn('replyRootCid', 'varchar')
    .addColumn('replyParent', 'varchar')
    .addColumn('replyParentCid', 'varchar')
    .addColumn('embed', 'text')
    .addColumn('facets', 'text')
    .addColumn('langs', 'varchar')
    .addColumn('labels', 'text')
    .addColumn('tags', 'text')
    .addColumn('createdAt', 'varchar', (col) => col.notNull())
    .addColumn('indexedAt', 'varchar', (col) => col.notNull())
    .addColumn('sortAt', 'varchar', (col) =>
      col
        .generatedAlwaysAs(sql`LEAST("createdAt", "indexedAt")`)
        .stored()
        .notNull(),
    )
    .execute()

  await sql`CREATE INDEX "stratos_post_creator_sort_at_idx" ON "stratos_post" ("creator", "sortAt" DESC)`.execute(
    db,
  )

  await sql`CREATE INDEX "stratos_post_sort_at_idx" ON "stratos_post" ("sortAt" DESC)`.execute(
    db,
  )

  await db.schema
    .createIndex('stratos_post_reply_root_idx')
    .on('stratos_post')
    .column('replyRoot')
    .execute()

  await db.schema
    .createTable('stratos_post_boundary')
    .addColumn('uri', 'varchar', (col) => col.notNull())
    .addColumn('boundary', 'varchar', (col) => col.notNull())
    .addPrimaryKeyConstraint('stratos_post_boundary_pkey', ['uri', 'boundary'])
    .execute()

  await db.schema
    .createIndex('stratos_post_boundary_boundary_uri_idx')
    .on('stratos_post_boundary')
    .columns(['boundary', 'uri'])
    .execute()

  await db.schema
    .createTable('stratos_enrollment')
    .addColumn('did', 'varchar', (col) => col.primaryKey())
    .addColumn('serviceUrl', 'varchar', (col) => col.notNull())
    .addColumn('enrolledAt', 'varchar', (col) => col.notNull())
    .addColumn('lastChecked', 'varchar', (col) => col.notNull())
    .addColumn('boundaries', 'text')
    .execute()

  await db.schema
    .createTable('stratos_sync_cursor')
    .addColumn('did', 'varchar', (col) => col.primaryKey())
    .addColumn('seq', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('updatedAt', 'varchar', (col) => col.notNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('stratos_sync_cursor').execute()
  await db.schema.dropTable('stratos_enrollment').execute()
  await db.schema.dropTable('stratos_post_boundary').execute()
  await db.schema.dropTable('stratos_post').execute()
}
