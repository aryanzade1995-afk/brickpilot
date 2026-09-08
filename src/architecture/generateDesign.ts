/* ------------------------------------------------------------------ *
 *  generateDesign — the seeded resolution step.
 *
 *      generateDesign(requirements, seed)
 *        requirements.floorPlan : the deterministic engine `Design`
 *        requirements.style     : one of the 8 StyleIds
 *        seed                   : same seed -> same DesignSpec
 *
 *  It layers the StyleGrammar over the floor plan and a seed:
 *    massing strategy · per-storey volumes · roof forms · per-room
 *    windows · doors · balconies · facade vocabulary · materials,
 *  then validates + repairs, and returns a serialisable DesignSpec —
 *  the single input (besides style knobs) to the Blender generator.
 *
 *  Blender-independent: the same DesignSpec also drives the fallback
 *  three.js builder.
 * ------------------------------------------------------------------ */

import type { Point, Rect } from '../lib/geometry.ts'
import { rectBottom, rectRight } from '../lib/geometry.ts'
import type { Design, FloorPlan } from '../lib/engine/types.ts'
import { makeRng } from '../lib/engine/shape/rng.ts'
import { resolveConstraints } from './constraints.ts'
import { styleGrammar, STYLE_OF_CHARACTER } from './grammar.ts'
import { classifyRoom } from './generator/classify.ts'
import { resolveBalconies } from './generator/balconyResolver.ts'
import { resolveFacade } from './generator/facadeResolver.ts'
import { resolveMassing } from './generator/massingResolver.ts'
import { resolveMaterials } from './generator/materialResolver.ts'
import { validateSpec } from './generator/validator.ts'
import { generateWindows } from './generator/windowGenerator.ts'
import type {
  DesignRequirements,
  DesignSpec,
  DesignSpecFloor,
  Direction4,
  DoorSpec,
  StairSpec,
  StyleGrammar,
  StyleId,
  WindowSpec,
} from './types.ts'

/** derive the grammar input from an engine Design (mirrors the wire spec) */
export function requirementsOf(design: Design, styleOverride?: StyleId): DesignRequirements {
  const b = design.model.brief
  const rooms = b.rooms
  return {
    style: styleOverride ?? STYLE_OF_CHARACTER[b.style.character],
    plotWidthMm: design.model.plot.width,
    plotDepthMm: design.model.plot.depth,
    setbacksMm: design.model.setbacksMm,
    entrySide: design.model.entrySide,
    floors: design.floors.length,
    floorHeightMm: Math.round(b.levels.floorToFloor * 1000),
    bedrooms: rooms.bedroomsWithBath + rooms.bedroomsNoBath,
    bathrooms: rooms.bedroomsWithBath + rooms.sharedBaths,
    parking: b.rooms.priorities.coveredParking ? (b.spaces.occupants >= 4 ? 2 : 1) : 0,
    seed: b.variation,
    floorPlan: design,
  }
}

export function generateDesign(req0: DesignRequirements, seed = req0.seed): DesignSpec {
  const grammar = styleGrammar(req0.style)
  const constraints = resolveConstraints(req0, grammar.constraints)
  // the style may demand grander (or tighter) storeys than the brief default —
  // a real geometry change, not just a knob
  const floorHeightMm = Math.round(
    Math.max(constraints.floorHeightMm[0], Math.min(req0.floorHeightMm, constraints.floorHeightMm[1])),
  )
  const req: DesignRequirements = { ...req0, floorHeightMm }
  const rng = makeRng(seed, `${req.style}|arch-grammar`)
  const design = req.floorPlan

  const massing = resolveMassing(grammar, req, constraints, rng)
  const buildable = {
    x: constraints.setbackMinMm.W,
    y: constraints.setbackMinMm.N,
    w: req.plotWidthMm - constraints.setbackMinMm.W - constraints.setbackMinMm.E,
    h: req.plotDepthMm - constraints.setbackMinMm.N - constraints.setbackMinMm.S,
  }

  const topLevel = design.floors.length - 1
  const risers = Math.max(14, Math.round(req.floorHeightMm / 175))

  const windowsByLevel: WindowSpec[][] = []
  const floors: DesignSpecFloor[] = design.floors.map((fl) => {
    // dedicated per-floor rng so upper floors are NOT a copy of the ground floor
    const frng = makeRng(seed, `${req.style}|floor${fl.level}`)
    const windows = generateWindows({
      grammar,
      constraints,
      floor: fl,
      level: fl.level,
      floorHeightMm: req.floorHeightMm,
      entrySide: req.entrySide,
      rng: frng,
    })
    windowsByLevel[fl.level] = windows
    const doors = resolveDoors(fl, grammar, req.entrySide)
    const balconies = resolveBalconies(grammar, constraints, fl, fl.level, buildable, frng)
    const stairs: StairSpec[] =
      fl.stair && fl.level < topLevel
        ? [
            {
              id: `stair${fl.level}`,
              level: fl.level,
              rect: fl.stair.rect,
              fromMm: fl.level * req.floorHeightMm,
              toMm: (fl.level + 1) * req.floorHeightMm,
              steps: risers,
              runDir: 'N',
              kind: 'dogleg',
            },
          ]
        : []
    return {
      level: fl.level,
      name: fl.name,
      heightMm: req.floorHeightMm,
      baseMm: fl.level * req.floorHeightMm,
      blocks: massing.perFloor[fl.level] ?? [],
      rooms: fl.rooms.map((r) => ({ id: r.id, class: classifyRoom(r), rect: r.rect, area: r.area, outdoor: r.outdoor })),
      windows,
      doors,
      balconies,
      stairs,
      courtyard: fl.courtyard ?? null,
    }
  })

  const materials = resolveMaterials(grammar, rng)
  const facade = resolveFacade(grammar, massing, req, windowsByLevel, rng)

  const briefHash = design.model.seed.split('-')[0]
  const spec: DesignSpec = {
    version: 1,
    id: `${briefHash}-${req.style}-${seed}`,
    style: req.style,
    seed,
    grammar: { id: grammar.id, label: grammar.label },
    plot: { widthMm: req.plotWidthMm, depthMm: req.plotDepthMm },
    setbacksMm: constraints.setbackMinMm,
    entrySide: req.entrySide,
    requirements: {
      floors: req.floors,
      bedrooms: req.bedrooms,
      bathrooms: req.bathrooms,
      parking: req.parking,
      builtUpAreaSqm: design.builtAreaSqm,
      floorHeightMm: req.floorHeightMm,
    },
    massing: { strategy: massing.strategy, planShape: massing.planShape, footprintMm: massing.footprintMm },
    floors,
    facade,
    materials,
    constraintsUsed: constraints,
    validation: { ok: true, issues: [], repaired: [] },
  }

  // validate → repair in place → validate once more
  spec.validation = validateSpec(spec, constraints)
  if (!spec.validation.ok) {
    const second = validateSpec(spec, constraints)
    spec.validation = { ok: second.issues.length === 0, issues: second.issues, repaired: [...spec.validation.repaired, ...second.repaired] }
  }
  return spec
}

/** convenience: straight from an engine Design */
export function specFromDesign(design: Design, styleOverride?: StyleId, seed?: number): DesignSpec {
  return generateDesign(requirementsOf(design, styleOverride), seed)
}

/* ------------------------------------------------------------------ */

function resolveDoors(fl: FloorPlan, grammar: StyleGrammar, _entrySide: Direction4): DoorSpec[] {
  const out: DoorSpec[] = []
  let i = 0
  for (const op of fl.openings) {
    if (op.kind === 'window') continue
    const isEntry = op.kind === 'entry'
    // find the room this opening sits on (nearest room whose edge it lies on)
    const host = fl.rooms.find((r) => onRoomEdge(r.rect, op.at)) ?? fl.rooms[0]
    const horiz = op.orient === 'h'
    const wall = horiz
      ? { a: { x: op.at.x - op.width / 2, y: op.at.y }, b: { x: op.at.x + op.width / 2, y: op.at.y } }
      : { a: { x: op.at.x, y: op.at.y - op.width / 2 }, b: { x: op.at.x, y: op.at.y + op.width / 2 } }
    const side: Direction4 = sideOfPoint(host.rect, op.at)
    out.push({
      id: `d${fl.level}-${i++}`,
      kind: isEntry ? 'entry' : 'internal',
      roomId: host.id,
      level: fl.level,
      wall,
      side,
      centerMm: op.width / 2,
      widthMm: isEntry
        ? Math.round(lerp(grammar.door.entryWidthMm[0], grammar.door.entryWidthMm[1], 0.5))
        : Math.max(op.width, grammar.door.internalWidthMm),
      heightMm: isEntry && grammar.door.doubleHeightEntry ? 3600 : 2100,
      double: isEntry ? grammar.door.doubleLeafEntry : op.width > 1400,
      canopyMm: isEntry ? grammar.door.entryCanopyMm : 0,
    })
  }
  return out
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function onRoomEdge(r: Rect, p: Point, tol = 200): boolean {
  const nearX = Math.abs(p.x - r.x) < tol || Math.abs(p.x - rectRight(r)) < tol
  const nearY = Math.abs(p.y - r.y) < tol || Math.abs(p.y - rectBottom(r)) < tol
  const inX = p.x >= r.x - tol && p.x <= rectRight(r) + tol
  const inY = p.y >= r.y - tol && p.y <= rectBottom(r) + tol
  return (nearX && inY) || (nearY && inX)
}

function sideOfPoint(r: Rect, p: Point): Direction4 {
  const d: Record<Direction4, number> = {
    N: Math.abs(p.y - r.y),
    S: Math.abs(p.y - rectBottom(r)),
    W: Math.abs(p.x - r.x),
    E: Math.abs(p.x - rectRight(r)),
  }
  return (Object.keys(d) as Direction4[]).sort((a, b) => d[a] - d[b])[0]
}
