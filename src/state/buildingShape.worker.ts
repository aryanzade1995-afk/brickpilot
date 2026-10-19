import { findNewBuildingShape, type BuildingShapeInput } from '../lib/engine/buildingShapes.ts'

self.onmessage = (event: MessageEvent<BuildingShapeInput>) => {
  try { self.postMessage({ ok: true, result: findNewBuildingShape(event.data) }) }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Could not plan a new building shape.' }) }
}
