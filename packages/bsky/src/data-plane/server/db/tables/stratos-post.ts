import { GeneratedAlways } from 'kysely'

export const tableName = 'stratos_post'

export interface StratosPost {
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
  sortAt: GeneratedAlways<string>
}

export type PartialDB = { [tableName]: StratosPost }
