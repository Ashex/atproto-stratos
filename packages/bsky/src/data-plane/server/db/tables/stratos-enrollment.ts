export const tableName = 'stratos_enrollment'

export interface StratosEnrollment {
  did: string
  serviceUrl: string
  enrolledAt: string
  lastChecked: string
  boundaries: string | null
}

export type PartialDB = { [tableName]: StratosEnrollment }
