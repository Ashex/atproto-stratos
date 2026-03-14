import { StratosStore } from './store'

export interface EnrollmentManagerConfig {
  stratosServiceUrl: string
  refreshIntervalMs: number
}

export interface ActorSubscriber {
  addActor(did: string): Promise<void>
}

export class StratosEnrollmentManager {
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private actorSubscriber: ActorSubscriber | null = null

  constructor(
    private store: StratosStore,
    private config: EnrollmentManagerConfig,
  ) {}

  setActorSubscriber(subscriber: ActorSubscriber): void {
    this.actorSubscriber = subscriber
  }

  start(): void {
    if (this.config.refreshIntervalMs > 0) {
      this.refreshTimer = setInterval(
        () => void this.refreshAll(),
        this.config.refreshIntervalMs,
      )
    }
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  async isEnrolled(did: string): Promise<boolean> {
    return this.store.isEnrolled(did)
  }

  async getBoundaries(viewerDid: string): Promise<string[]> {
    const cached = await this.store.getBoundaries(viewerDid)
    if (cached.length > 0) return cached

    // Fallback: query Stratos service directly and cache the result
    const enrollment = await this.fetchEnrollmentFromStratos(viewerDid)
    if (!enrollment) return []
    await this.store.upsertEnrollment(enrollment)
    await this.actorSubscriber?.addActor(viewerDid)
    return enrollment.boundaries
  }

  async getEnrollment(did: string) {
    const cached = await this.store.getEnrollment(did)
    if (cached) return cached

    const fetched = await this.fetchEnrollmentFromStratos(did)
    if (!fetched) return null

    await this.store.upsertEnrollment(fetched)
    await this.actorSubscriber?.addActor(did)
    return this.store.getEnrollment(did)
  }

  private async fetchEnrollmentFromStratos(did: string): Promise<{
    did: string
    serviceUrl: string
    enrolledAt: string
    boundaries: string[]
  } | null> {
    const enrollmentUrl = new URL(
      `/xrpc/zone.stratos.identity.resolveEnrollments?did=${encodeURIComponent(did)}`,
      this.config.stratosServiceUrl,
    )

    const res = await fetch(enrollmentUrl.toString())

    if (!res.ok) {
      console.log(`[stratos] enrollment fetch failed for ${did}: ${res.status} ${res.statusText}`)
      return null
    }

    const body = (await res.json()) as {
      did: string
      enrolled: boolean
      boundaries?: string[]
    }

    if (!body.enrolled) return null

    const boundaries = body.boundaries ?? []

    console.log(`[stratos] enrollment fetched for ${did}: ${boundaries.length} boundaries`, boundaries)

    return {
      did: body.did,
      serviceUrl: this.config.stratosServiceUrl,
      enrolledAt: new Date().toISOString(),
      boundaries,
    }
  }

  private async refreshAll(): Promise<void> {
    const enrollments = await this.store.getAllEnrollments()
    for (const enrollment of enrollments) {
      try {
        const fresh = await this.fetchEnrollmentFromStratos(enrollment.did)
        if (fresh) {
          await this.store.upsertEnrollment(fresh)
        }
      } catch {
        // Skip individual failures; will retry on next cycle
      }
    }
  }
}
