export const tableName = 'stratos_post_boundary'

export interface StratosPostBoundary {
  uri: string
  boundary: string
}

export type PartialDB = { [tableName]: StratosPostBoundary }
