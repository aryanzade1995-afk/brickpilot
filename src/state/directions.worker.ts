/// <reference lib="webworker" />
/* The four design directions are several seconds of plan and architecture generation. They run here, off the main
 * thread, so the page keeps scrolling, animating and answering clicks while they are made. */
import { computeDirections, type DirectionsInput } from './studio.ts'

self.onmessage = (event: MessageEvent<DirectionsInput>) => {
  try {
    self.postMessage({ ok: true, result: computeDirections(event.data) })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
