import type { generateAlternativeDesign } from '../generateAlternativeDesign.ts'

type Architecture = ReturnType<typeof generateAlternativeDesign>
const ordered = (items: unknown[]) => items.map(item => JSON.stringify(item)).sort()
const box = (r: { x: number; y: number; w: number; h: number; z?: number; height?: number }) =>
  [r.x, r.y, r.w, r.h, r.z ?? 0, r.height ?? 0].map(n => Math.round(n))

/** Actual millimetre geometry, independent of seed, labels, colours and lighting.
 * A conservative duplicate key complements the perceptual similarity gate. */
export function villaGeometryIdentity(a: Architecture): string {
  const b = a.buildingModel
  const levels = new Map(b.floors.map(f => [f.id, f.elevationMm]))
  return JSON.stringify({
    schemaVersion: 1,
    floors: ordered(b.floors.map(f => [f.elevationMm, f.heightMm, ordered(f.footprint.map(box)), f.courtyard && box(f.courtyard)])),
    walls: ordered(b.walls.map(w => [levels.get(w.floorId), w.a, w.b, w.thickness, w.heightMm ?? null])),
    openings: ordered([...b.doors, ...b.windows].map(o => [levels.get(o.floorId), o.kind, o.orient, o.at, o.width, o.sill ?? 0, o.head ?? null])),
    masses: ordered(a.massingModel.masses.map(m => [m.x, m.y, m.elevation, m.width, m.depth, m.height, m.rotation])),
    features: ordered(a.facadeGrammar.features.flatMap(f => f.parts.map(p => box(p.world)))),
    components: ordered((a.facadeGrammar.specialized?.assemblies ?? []).flatMap(g =>
      g.parts.filter(p => !['finish', 'cladding', 'planter'].includes(p.role)).map(p => [p.operation, box(p.world)]))),
  })
}
