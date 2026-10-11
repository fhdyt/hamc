import type { CronJob } from '@shared/events'

export const jobKey = (profile: string, id: string): string => `${profile}/${id}`

export class CronStore {
  private jobs = new Map<string, CronJob>()

  apply(jobs: readonly CronJob[]): void {
    this.jobs = new Map(jobs.map((j) => [jobKey(j.profile, j.id), j]))
  }

  get(profile: string, id: string): CronJob | undefined {
    return this.jobs.get(jobKey(profile, id))
  }

  all(): CronJob[] {
    return [...this.jobs.values()]
  }

  clear(): void {
    this.jobs.clear()
  }
}
