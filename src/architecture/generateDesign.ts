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
import { BALCONY, DOOR, STAIR, STRUCTURE, WINDOW, stairSteps } from './dims.ts'
import { resolveConstraints } from './constraints.ts'
import { styleGrammar, STYLE_OF_CHARACTER } from './grammar.ts'
import { classifyRoom, planShapeOf } from './generator/classify.ts'
import { auditArchitecture } from './generator/architecturalValidator.ts'
import { resolveBalconies } from './generator/balconyResolver.ts'
import { resolveFacade } from './generator/facadeResolver.ts'
import { resolveMassing } from './generator/massingResolver.ts'
import { resolveMaterials } from './generator/materialResolver.ts'
import { resolveStructure } from './generator/structure.ts'
import { validateSpec } from './generator/validator.ts'
import { generateWindows } from './generator/windowGenerator.ts'
import { architecturalFingerprint } from './library/fingerprint.ts'
import { resolveGenome } from './library/designGenome.ts'
import { referenceHints } from './library/designLibrary.ts'
import { stylePattern } from './library/stylePatterns.ts'
import { entranceEntry } from './library/entranceLibrary.ts'
import type { EntranceType } from './library/architecturalVocabulary.ts'
import type {
  BalconySpec,
  DesignGenome,
  DesignRequirements,
  DesignSpec,
  DesignSpecFloor,
  Direction4,
  DoorSpec,
  GenerationConstraints,
  StairSpec,
  StyleGrammar,
  StyleId,
  WindowSpec,
} from './types.ts'

/** the numeric seed the engine actually generated this design with.
 *  `design.id` is `${model.seed}-${shape}-${seed}` — the trailing segment is
 *  it. When a direction is pinned the pinned seed is used here, not
 *  `brief.variation`, so "Regenerate design" produces a genuinely new genome. */
export function seedOf(design: Design): number {
  const tail = Number(design.id.split('-').pop())
  return Number.isFinite(tail) ? tail : design.model.brief.variation
}

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
    seed: seedOf(design),
    floorPlan: design,
  }
}

/** major-error retry budget (§14: "major errors must trigger regeneration") */
const MAX_ATTEMPTS = 4

export function generateDesign(req0: DesignRequirements, seed = req0.seed): DesignSpec {
  let best: DesignSpec | null = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const trySeed = attempt === 0 ? seed : seed + attempt * 1000 + 7
    const spec = buildOnce(req0, trySeed, seed)
    spec.audit.attempts = attempt
    if (spec.audit.errors.length === 0) return spec
    if (!best || spec.audit.score > best.audit.score) best = spec
  }
  return best!
}

function buildOnce(req0: DesignRequirements, seed: number, canonicalSeed: number): DesignSpec {
  const grammar = styleGrammar(req0.style)
  const constraints = resolveConstraints(req0, grammar.constraints)
  // the style may demand grander (or tighter) storeys than the brief default —
  // a real geometry change, not just a knob
  const floorHeightMm = Math.round(
    Math.max(constraints.floorHeightMm[0], Math.min(req0.floorHeightMm, constraints.floorHeightMm[1])),
  )
  // the engine builds the entry on the plan-south (bottom) edge whatever the
  // model's cardinal `entrySide` label says — the spec + Blender + validator all
  // work in the plan frame, so normalise entrySide to the geometric side here.
  const entrySide = planEntrySide(req0.floorPlan)
  const req: DesignRequirements = { ...req0, floorHeightMm, entrySide }
  const rng = makeRng(seed, `${req.style}|arch-grammar`)
  const design = req.floorPlan

  // ---- compose the architectural DESIGN GENOME (seeded, compatibility-checked)
  //      the reference library nudges the picks; the plot / rooms / floors do not move
  const planShape = planShapeOf(design.shape)
  const genome = resolveGenome(
    stylePattern(req.style),
    req,
    constraints,
    planShape,
    makeRng(seed, `${req.style}|genome`),
    referenceHints(req.style, design.shape),
  )

  const massing = resolveMassing(grammar, req, constraints, rng, genome)
  const buildable = {
    x: constraints.setbackMinMm.W,
    y: constraints.setbackMinMm.N,
    w: req.plotWidthMm - constraints.setbackMinMm.W - constraints.setbackMinMm.E,
    h: req.plotDepthMm - constraints.setbackMinMm.N - constraints.setbackMinMm.S,
  }

  const topLevel = design.floors.length - 1

  // ---- STRUCTURAL GRID → COLUMNS → BEAMS → SLABS (§10) — grid snaps to the
  //      massing blocks + the partition walls, so columns land on walls
  const structure = resolveStructure(
    massing.perFloor,
    design.floors.length,
    design.floors.map((fl) => fl.rooms.filter((r) => !r.outdoor).map((r) => r.rect)),
  )

  const windowsByLevel: WindowSpec[][] = []
  const doorsByLevel: DoorSpec[][] = []
  const floors: DesignSpecFloor[] = design.floors.map((fl) => {
    // dedicated per-floor rng so upper floors are NOT a copy of the ground floor
    const frng = makeRng(seed, `${req.style}|floor${fl.level}`)
    // doors + balconies FIRST — so windows are generated clear of them (§3)
    const doors = resolveDoors(fl, grammar, req.entrySide, genome)
    const balconies = resolveBalconies(grammar, constraints, fl, fl.level, buildable, frng, genome)
    const balconyDoors = balconies.map((b) => balconyDoorSpec(b, fl))
    doors.push(...balconyDoors.filter((d): d is DoorSpec => d != null))
    doorsByLevel[fl.level] = doors
    const windows = generateWindows({
      grammar,
      constraints,
      floor: fl,
      level: fl.level,
      floorHeightMm: req.floorHeightMm,
      entrySide: req.entrySide,
      rng: frng,
      genome,
      extraDoors: doors.map((d) => ({ at: { x: (d.wall.a.x + d.wall.b.x) / 2, y: (d.wall.a.y + d.wall.b.y) / 2 }, width: d.widthMm })),
    })
    windowsByLevel[fl.level] = windows
    const stairs: StairSpec[] =
      fl.stair && fl.level < topLevel
        ? [makeStair(`stair${fl.level}`, fl.level, fl.stair.rect, fl.level * req.floorHeightMm, (fl.level + 1) * req.floorHeightMm, constraints)]
        : []
    const st = structure.perFloor[fl.level] ?? { columns: [], beams: [], slabs: [] }
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
      columns: st.columns,
      beams: st.beams,
      slabs: st.slabs,
      courtyard: fl.courtyard ?? null,
    }
  })

  // ---- balcony + canopy slabs added to the structure (every balcony gets a slab + support)
  addBalconyAndCanopySlabs(floors, genome)

  // ---- §13 collision repair: nudge every opening clear of the columns on its wall
  const repairs = snapOpeningsToStructure(floors)
  // rebuild the per-level window index from the POST-repair floors so the facade
  // only ever anchors to a window that still exists
  for (const fl of floors) windowsByLevel[fl.level] = fl.windows

  const materials = resolveMaterials(grammar, rng, genome)
  // FACADE runs LAST — every element anchors to a real block / opening / column (§9)
  const facade = resolveFacade(grammar, massing, req, windowsByLevel, rng, genome, floors, structure)

  const briefHash = design.model.seed.split('-')[0]
  const spec: DesignSpec = {
    version: 1,
    id: `${briefHash}-${req.style}-${canonicalSeed}`,
    style: req.style,
    seed: canonicalSeed,
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
    grid: structure.grid,
    genome,
    fingerprint: architecturalFingerprint(genome, req.floors),
    floors,
    facade,
    materials,
    constraintsUsed: constraints,
    validation: { ok: true, issues: [], repaired: [] },
    audit: { valid: true, score: 100, errors: [], warnings: [], repairs: [], attempts: 0 },
  }

  // cheap geometry validate → repair in place → re-validate
  spec.validation = validateSpec(spec, constraints)
  if (!spec.validation.ok) {
    const second = validateSpec(spec, constraints)
    spec.validation = { ok: second.issues.length === 0, issues: second.issues, repaired: [...spec.validation.repaired, ...second.repaired] }
  }
  spec.validation.repaired.push(...repairs)
  // the full architectural audit (§14) — errors here drive regeneration in generateDesign()
  spec.audit = auditArchitecture(spec, design)
  spec.audit.repairs.push(...repairs)
  return spec
}

/** nudge each window / door along its wall to clear every column on that wall
 *  line; drop an opening only when no clear span ≥ its width exists (§13). */
function snapOpeningsToStructure(floors: DesignSpecFloor[]): string[] {
  const repairs: string[] = []
  for (const fl of floors) {
    const colsOnWall = (wall: { a: Point; b: Point }, side: Direction4) => {
      const horiz = side === 'N' || side === 'S'
      const fixed = horiz ? wall.a.y : wall.a.x
      return fl.columns
        .filter((c) => c.role !== 'porch' && c.role !== 'verandah')
        .filter((c) => Math.abs((horiz ? c.at.y : c.at.x) - fixed) < 350)
        .map((c) => ({ along: (horiz ? c.at.x : c.at.y), half: c.sizeMm[0] / 2 }))
    }
    const wallStart = (wall: { a: Point; b: Point }, side: Direction4) => (side === 'N' || side === 'S' ? Math.min(wall.a.x, wall.b.x) : Math.min(wall.a.y, wall.b.y))
    const wallEndOf = (wall: { a: Point; b: Point }, side: Direction4) => (side === 'N' || side === 'S' ? Math.max(wall.a.x, wall.b.x) : Math.max(wall.a.y, wall.b.y))

    // treat doors on the same wall as extra keep-outs for windows
    const doorsOnWall = (wall: { a: Point; b: Point }, side: Direction4) => {
      const horiz = side === 'N' || side === 'S'
      const fixed = horiz ? wall.a.y : wall.a.x
      return fl.doors
        .filter((d) => d.side === side && Math.abs((horiz ? d.wall.a.y : d.wall.a.x) - fixed) < 350)
        .map((d) => ({ along: horiz ? (d.wall.a.x + d.wall.b.x) / 2 : (d.wall.a.y + d.wall.b.y) / 2, half: d.widthMm / 2 + WINDOW.minDoorDistanceMm }))
    }

    for (const w of fl.windows) {
      const cols = [...colsOnWall(w.wall, w.side), ...doorsOnWall(w.wall, w.side)]
      if (!cols.length) continue
      const lo = wallStart(w.wall, w.side) + WINDOW.minCornerOffsetMm
      const hi = wallEndOf(w.wall, w.side) - WINDOW.minCornerOffsetMm
      const abs0 = wallStart(w.wall, w.side) + w.centerMm
      const bay = bestBay(abs0, cols, lo, hi, WINDOW.minColumnDistanceMm)
      if (!bay || bay.hi - bay.lo < 600) {
        // no room on this wall — a balcony / entry door on the wall covers light + vent
        repairs.push(`${w.id}: dropped (opening clash on wall)`)
        w.widthMm = 0
        continue
      }
      const newW = Math.min(w.widthMm, bay.hi - bay.lo)
      const newC = (bay.lo + bay.hi) / 2
      if (newW < w.widthMm - 20 || Math.abs(newC - abs0) > 20) {
        repairs.push(`${w.id}: ${newW < w.widthMm - 20 ? `narrowed to ${newW | 0}mm` : `nudged ${Math.round(newC - abs0)}mm`} clear of a column`)
        w.widthMm = Math.round(newW)
        w.centerMm = Math.round(newC - wallStart(w.wall, w.side))
        w.mullions = w.widthMm > 1650 ? Math.max(1, Math.floor((w.widthMm - 250) / 1450)) : 0
      }
    }
    fl.windows = fl.windows.filter((w) => w.widthMm >= 350)

    for (const d of fl.doors) {
      if (d.kind === 'entry') continue
      const cols = colsOnWall(d.wall, d.side)
      if (!cols.length) continue
      const lo = wallStart(d.wall, d.side)
      const hi = wallEndOf(d.wall, d.side)
      const dm = d.side === 'N' || d.side === 'S' ? (d.wall.a.x + d.wall.b.x) / 2 : (d.wall.a.y + d.wall.b.y) / 2
      const moved = clearOf(dm, d.widthMm / 2, cols, lo, hi, DOOR.cornerClearanceMm)
      if (moved != null && Math.abs(moved - dm) > 20) {
        const shift = moved - dm
        const horiz = d.side === 'N' || d.side === 'S'
        d.wall = horiz
          ? { a: { x: d.wall.a.x + shift, y: d.wall.a.y }, b: { x: d.wall.b.x + shift, y: d.wall.b.y } }
          : { a: { x: d.wall.a.x, y: d.wall.a.y + shift }, b: { x: d.wall.b.x, y: d.wall.b.y + shift } }
        repairs.push(`${d.id}: nudged ${Math.round(shift)}mm clear of a column`)
      }
    }
  }
  return repairs
}

/** the clear span between consecutive columns that contains (or is nearest to) `at` */
function bestBay(
  at: number,
  cols: { along: number; half: number }[],
  lo: number,
  hi: number,
  gap: number,
): { lo: number; hi: number } | null {
  const stops = [lo, ...cols.flatMap((c) => [c.along - c.half - gap, c.along + c.half + gap]), hi].sort((a, b) => a - b)
  const bays: { lo: number; hi: number }[] = []
  for (let i = 0; i < stops.length - 1; i++) {
    const a = Math.max(stops[i], lo)
    const b = Math.min(stops[i + 1], hi)
    // this segment is clear only if its midpoint isn't inside a column keep-out
    const mid = (a + b) / 2
    const inCol = cols.some((c) => mid > c.along - c.half - gap && mid < c.along + c.half + gap)
    if (!inCol && b - a > 100) bays.push({ lo: a, hi: b })
  }
  if (!bays.length) return null
  return bays.sort((x, y) => Math.abs((x.lo + x.hi) / 2 - at) - Math.abs((y.lo + y.hi) / 2 - at))[0]
}

/** nearest clear position for a `half`-wide opening centred at `at` (doors) */
function clearOf(
  at: number,
  half: number,
  cols: { along: number; half: number }[],
  lo: number,
  hi: number,
  gap: number,
): number | null {
  if (hi - lo < half * 2) return null
  const blocked = cols.map((c) => [c.along - c.half - gap - half, c.along + c.half + gap + half] as [number, number])
  const clear = (p: number) => p - half >= lo && p + half <= hi && !blocked.some(([a, b]) => p > a && p < b)
  if (clear(at)) return at
  for (let step = 100; step < hi - lo; step += 100) {
    if (clear(at + step)) return at + step
    if (clear(at - step)) return at - step
  }
  return null
}

/** an NBC-compliant dog-leg stair for a floor-to-floor rise */
function makeStair(id: string, level: number, rect: Rect, fromMm: number, toMm: number, c: GenerationConstraints): StairSpec {
  const s = stairSteps(toMm - fromMm)
  const widthMm = Math.max(STAIR.minWidthMm, Math.min(rect.w, rect.h) / (s.flights > 1 ? 2 : 1) - 100)
  return {
    id,
    level,
    rect,
    fromMm,
    toMm,
    steps: s.risers,
    runDir: 'N',
    kind: s.flights > 1 ? 'dogleg' : 'straight',
    treadMm: s.treadMm,
    riserMm: s.riserMm,
    widthMm: Math.round(widthMm),
    flights: s.flights,
    landingMm: Math.max(STAIR.minLandingMm, Math.round(widthMm)),
    headroomMm: Math.max(STAIR.minHeadroomMm, c.floorHeightMm[0] - 400),
  }
}

/** the balcony access door — on the host room wall, aligned to the balcony (§6) */
function balconyDoorSpec(b: BalconySpec, fl: FloorPlan): DoorSpec | null {
  const room = fl.rooms.find((rm) => rm.id === b.roomId)
  if (!room) return null
  const r = room.rect
  const w = DOOR.balcony.widthMm
  const bcx = Math.max(r.x + w, Math.min(rectRight(r) - w, b.rect.x + b.rect.w / 2))
  const bcy = Math.max(r.y + w, Math.min(rectBottom(r) - w, b.rect.y + b.rect.h / 2))
  const s = b.side
  const mid: Point =
    s === 'S' ? { x: bcx, y: rectBottom(r) } : s === 'N' ? { x: bcx, y: r.y } : s === 'W' ? { x: r.x, y: bcy } : { x: rectRight(r), y: bcy }
  const horiz = s === 'S' || s === 'N'
  return {
    id: `bd-${b.id}`,
    kind: 'balcony',
    roomId: b.roomId,
    level: fl.level,
    wall: horiz
      ? { a: { x: mid.x - w / 2, y: mid.y }, b: { x: mid.x + w / 2, y: mid.y } }
      : { a: { x: mid.x, y: mid.y - w / 2 }, b: { x: mid.x, y: mid.y + w / 2 } },
    side: s,
    centerMm: w / 2,
    widthMm: w,
    heightMm: DOOR.balcony.heightMm,
    double: true,
    canopyMm: 0,
  }
}

/** every balcony → a slab + support; every entry canopy → a slab + porch columns + beam */
function addBalconyAndCanopySlabs(floors: DesignSpecFloor[], genome: DesignGenome): void {
  for (const fl of floors) {
    for (const b of fl.balconies) {
      const cantSide = b.side
      fl.slabs.push({
        id: `slab-${b.id}`,
        level: fl.level,
        rect: b.rect,
        thicknessMm: BALCONY.slabThicknessMm,
        cantilever: b.recessed ? {} : { [cantSide]: b.depthMm },
        supports: `balcony:${b.roomId}`,
      })
      // a deep projecting balcony needs a real column, not just a cantilever
      if (!b.recessed && b.depthMm > BALCONY.maxCantileverMm) {
        const y = cantSide === 'S' ? rectBottom(b.rect) : cantSide === 'N' ? b.rect.y : b.rect.y + b.rect.h / 2
        const x = cantSide === 'E' ? rectRight(b.rect) : cantSide === 'W' ? b.rect.x : b.rect.x + b.rect.w / 2
        fl.columns.push({
          id: `col-${b.id}`,
          gridRef: `BAL`,
          at: { x, y },
          level: fl.level - 1,
          sizeMm: [STRUCTURE.porchColumnMm, STRUCTURE.porchColumnMm],
          role: 'verandah',
          alignedBelow: null,
        })
      }
    }
  }
  void genome
}

/** convenience: straight from an engine Design */
export function specFromDesign(design: Design, styleOverride?: StyleId, seed?: number): DesignSpec {
  return generateDesign(requirementsOf(design, styleOverride), seed)
}

/* ------------------------------------------------------------------ */

function resolveDoors(fl: FloorPlan, grammar: StyleGrammar, entrySide: Direction4, genome: DesignGenome): DoorSpec[] {
  const out: DoorSpec[] = []
  let i = 0
  const ent = entranceEntry(genome.entrance as EntranceType)
  const doubleHeight = genome.doubleHeightEntrance
  const entryDims = doubleHeight ? DOOR.entryDoubleHeight : DOOR.entry
  const entryWidth = Math.round(clampR(lerp(ent.entryWidthMm[0], ent.entryWidthMm[1], 0.5), entryDims.widthMm))
  const canopyMm = Math.round(lerp(ent.canopyMm[0], ent.canopyMm[1], 0.5))
  let hasEntry = false
  // the engine can emit the same physical opening from both sides of a shared
  // wall, or two doors that overlap on one wall — collapse them (keep the wider)
  const rawDoors = [...fl.openings.filter((o) => o.kind !== 'window')].sort((p, q) => q.width - p.width)
  const doorOps: typeof rawDoors = []
  for (const o of rawDoors) {
    const clash = doorOps.some((p) => {
      if (p.orient !== o.orient) return false
      const perp = o.orient === 'h' ? Math.abs(p.at.y - o.at.y) : Math.abs(p.at.x - o.at.x)
      const along = o.orient === 'h' ? Math.abs(p.at.x - o.at.x) : Math.abs(p.at.y - o.at.y)
      return perp < 400 && along < p.width / 2 + o.width / 2 + 150
    })
    if (!clash) doorOps.push(o)
  }
  for (const op of doorOps) {
    const isEntry = op.kind === 'entry'
    if (isEntry) hasEntry = true
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
      widthMm: isEntry ? entryWidth : Math.max(op.width, DOOR.internal.widthMm),
      heightMm: isEntry ? entryDims.heightMm : DOOR.internal.heightMm,
      double: isEntry ? grammar.door.doubleLeafEntry || entryWidth >= 1700 : op.width > 1400,
      canopyMm: isEntry ? canopyMm : 0,
    })
  }

  // §2/§8 — a ground floor MUST have an entrance. If the plan didn't emit one,
  // synthesise it on the entry-side exterior wall of the foyer / living / lobby.
  if (fl.level === 0 && !hasEntry) {
    const target =
      fl.rooms.find((r) => r.id === 'foyer') ??
      fl.rooms.find((r) => /living|familyLounge|lobby/.test(r.id)) ??
      fl.rooms.find((r) => !r.outdoor) ??
      fl.rooms[0]
    if (target) {
      const r = target.rect
      const mid =
        entrySide === 'S'
          ? { x: r.x + r.w / 2, y: rectBottom(r) }
          : entrySide === 'N'
            ? { x: r.x + r.w / 2, y: r.y }
            : entrySide === 'W'
              ? { x: r.x, y: r.y + r.h / 2 }
              : { x: rectRight(r), y: r.y + r.h / 2 }
      const horiz = entrySide === 'S' || entrySide === 'N'
      const wall = horiz
        ? { a: { x: mid.x - entryWidth / 2, y: mid.y }, b: { x: mid.x + entryWidth / 2, y: mid.y } }
        : { a: { x: mid.x, y: mid.y - entryWidth / 2 }, b: { x: mid.x, y: mid.y + entryWidth / 2 } }
      out.push({
        id: `d0-entry`,
        kind: 'entry',
        roomId: target.id,
        level: 0,
        wall,
        side: entrySide,
        centerMm: entryWidth / 2,
        widthMm: entryWidth,
        heightMm: entryDims.heightMm,
        double: entryWidth >= 1700,
        canopyMm,
      })
    }
  }
  return out
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clampR = (v: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, v))

/** the geometric plan-frame side the entry opening sits on (engine builds it at
 *  the bottom edge = plan-south; fall back to 'S') */
function planEntrySide(design: Design): Direction4 {
  const g = design.floors[0]
  const op = g?.openings.find((o) => o.kind === 'entry')
  if (!op || !g) return 'S'
  const b = rectUnionBBoxOf(g)
  const d: Record<Direction4, number> = {
    N: Math.abs(op.at.y - b.y),
    S: Math.abs(op.at.y - (b.y + b.h)),
    W: Math.abs(op.at.x - b.x),
    E: Math.abs(op.at.x - (b.x + b.w)),
  }
  return (Object.keys(d) as Direction4[]).sort((a, c) => d[a] - d[c])[0]
}

function rectUnionBBoxOf(fl: FloorPlan): Rect {
  const rs = fl.footprint?.length ? fl.footprint : [fl.outline]
  const x0 = Math.min(...rs.map((r) => r.x))
  const y0 = Math.min(...rs.map((r) => r.y))
  const x1 = Math.max(...rs.map((r) => rectRight(r)))
  const y1 = Math.max(...rs.map((r) => rectBottom(r)))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

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
