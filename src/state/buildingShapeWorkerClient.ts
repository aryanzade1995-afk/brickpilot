import { findNewBuildingShape, type BuildingShapeInput } from '../lib/engine/buildingShapes.ts'

export function runBuildingShapeSearch(input: BuildingShapeInput): Promise<ReturnType<typeof findNewBuildingShape>> {
  if (typeof Worker === 'undefined') return Promise.resolve(findNewBuildingShape(input))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./buildingShape.worker.ts', import.meta.url), { type: 'module' })
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('The building-shape search timed out. Please try again.')) }, 60000)
    const done = () => { clearTimeout(timeout); worker.terminate() }
    worker.onmessage = event => { done(); if (event.data.ok) resolve(event.data.result); else reject(new Error(event.data.error)) }
    worker.onerror = event => { done(); reject(new Error(event.message || 'Could not plan a new building shape.')) }
    worker.postMessage(JSON.parse(JSON.stringify(input)))
  })
}
