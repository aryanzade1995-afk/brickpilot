import type { computeDirections, DirectionsInput } from './studio.ts'

type Result = ReturnType<typeof computeDirections>

/** generate the directions in a worker; rejects (and the caller falls back to the main thread) if a worker cannot run */
export function runDirections(input: DirectionsInput): Promise<Result> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./directions.worker.ts', import.meta.url), { type: 'module' })
    } catch (error) { reject(error); return }
    const done = () => worker.terminate()
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: Result; error?: string }>) => {
      done()
      if (event.data.ok && event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error ?? 'Directions could not be generated.'))
    }
    worker.onerror = (event) => { done(); reject(new Error(event.message || 'Directions worker failed.')) }
    // plain data only: the brief, the pinned choice and the recent-villa history
    worker.postMessage(JSON.parse(JSON.stringify(input)))
  })
}
