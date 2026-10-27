import type { Design } from '../engine/types.ts'
import type { BuildingModel } from '../engine/buildingModel.ts'
import type { Brief } from '../model/brief.ts'
import { createVillaPlumbing, selectedPipeSizes } from '../plumbing/villaPlumbing.ts'
import { utilityFloor } from '../utilities/plan.ts'
import { readDrainageDrawing, resolveDrainageFloor } from '../utilities/sharedDrainage.ts'
import { SIMPLE_WATER_DEFAULTS, proposeRainCollection } from './simpleSystem.ts'
import type { WaterConfig } from './schema.ts'
import { proposeDrainStorage } from './drainageStorage.ts'
import { connectedDrainageNetwork } from './drainageNetwork.ts'
import { fixtureDrainageScene, fixtureWasteConnection } from './fixtureDrainage.ts'
import { coordinateDrainageContinuity } from './drainageContinuity.ts'
import { coordinateSupply } from './supplyContinuity.ts'

/** One read-only coordination proposal for Water Intelligence, Massing and
 * walking. Source drawings and user edits remain the authority. Coordinates
 * stay in plan mm until the renderer's planToThreeGlb (X, elevation, -Y)/1000.
 * This never edits architecture, accepted assets, costs or hydraulic approval. */
export function projectPipelines(design: Design, building: BuildingModel, brief: Brief,
  projectId: string | null, preferences?: WaterConfig['simple'], storage?: Pick<Storage, 'getItem'>) {
  const options = { ...SIMPLE_WATER_DEFAULTS, ...preferences }
  const home = createVillaPlumbing(building, selectedPipeSizes(brief), [], options.roofDiameterScale ?? 1, true)
  const originalPorts = createVillaPlumbing(building, selectedPipeSizes(brief)).tankPorts
  const rain = proposeRainCollection(building, Number(options.tankLitres))
  // Reserve the same rain tank site even outside the rain view, so switching
  // viewers cannot move the drainage tank or its collector.
  const drainage = proposeDrainStorage(building, home, rain.tank ? [{
    x: rain.tank.center.x - rain.tank.radiusMm, y: rain.tank.center.y - rain.tank.radiusMm,
    w: rain.tank.radiusMm * 2, h: rain.tank.radiusMm * 2,
  }] : [])
  const issues: string[] = []
  const floors = design.floors.flatMap(f => {
    const source = utilityFloor(design, f.level, brief)
    const saved = readDrainageDrawing(`${projectId ?? `draft:${design.id}`}:floor:${f.level}`, source, storage)
    issues.push(...saved.issues)
    if (!saved.compatible) return []
    const resolved = resolveDrainageFloor(saved.model, saved.drainage, saved.planning)
    issues.push(...resolved.reviews.map(r => r.reason))
    return [resolved.model]
  })
  const initialNetwork = connectedDrainageNetwork(building, home, drainage)
  const rawFixtureScene = fixtureDrainageScene(floors, building, home, initialNetwork, brief)
  const continuity = coordinateDrainageContinuity(building, home, drainage, rawFixtureScene)
  const fixtureScene = continuity.scene
  const drainNetwork = fixtureScene.configuredDischarge ? connectedDrainageNetwork(building, home,
    { ...drainage, tank: null, layout: { ...drainage.layout, pipes: [], segments: [] } }) : continuity.network
  const supply = coordinateSupply(building, home, floors)
  const drainFixtureRuns = fixtureScene.fixtures.flatMap(f => f.branch ? [
    { system: 'drain' as const, diameterMm: f.branch.diameterMm, points: f.branch.points },
    { system: 'drain' as const, diameterMm: f.kind === 'toilet' ? f.branch.diameterMm : Math.min(f.branch.diameterMm, 50), points: fixtureWasteConnection(f) },
  ] : [])
  return { planId: building.planId, options, home, originalPorts, rain, drainage, floors,
    rawFixtureScene, fixtureScene, continuity, drainNetwork, supply, drainFixtureRuns, issues }
}
export type ProjectPipelines = ReturnType<typeof projectPipelines>
