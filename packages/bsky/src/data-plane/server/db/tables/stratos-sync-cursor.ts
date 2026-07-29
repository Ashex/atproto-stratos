export const tableName = 'stratos_sync_cursor'

export interface StratosSyncCursor {
  did: string
  seq: number
  updatedAt: string
}

export type PartialDB = { [tableName]: StratosSyncCursor }
