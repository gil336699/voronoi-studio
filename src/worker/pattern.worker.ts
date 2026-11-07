// Runs pattern jobs off the main thread, so big counts and many relax steps never freeze the page.
import { runJob, type Job } from './jobs'

self.onmessage = (event: MessageEvent<{ id: number; job: Job }>) => {
  const { id, job } = event.data
  try {
    const result = runJob(job)
    ;(self as unknown as Worker).postMessage({ id, result }, [result.points.buffer])
  } catch (error) {
    ;(self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
