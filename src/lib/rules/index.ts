import { validateSiteFeatures } from '../engine/planner/siteFeatures.ts'
import { PLANNING_LIMITS as PLANNING } from '../engine/planner/limits.ts'
import { rectRight, rectBottom, rectUnionArea, rectUnionEdges, toSqm } from '../geometry.ts'
import type { CanonicalModel, SpaceReq } from '../model/canonical.ts'
import type { Design } from '../engine/types.ts'
import { planFindings } from '../engine/planner/validate.ts'
import { validateVillaVariation } from '../engine/facade/grammar.ts'
import { roomQuadrant } from '../engine/orientation.ts'
import { strictVastuFailures } from '../engine/score.ts'

export type Severity = 'error' | 'warning' | 'info'
export type FindingCategory =
  | 'geometry'
  | 'egress'
  | 'topology'
  | 'vertical'
  | 'planning'
  | 'vastu'

export type Finding = {
  code: string
  severity: Severity
  category: FindingCategory
  message: string
  roomId?: string
}

export type ValidationReport = {
  pack: string
  score: number
  hardChecksPass: boolean
  findings: Finding[]
  counts: Record<Severity, number>
  checksRun: FindingCategory[]
}

export const RULE_PACK = 'residential-v1'

/** planning limits — placeholder until wired to local development-control rules */


const MIN_DIM: Record<string, number> = {
  private: 2400,
  service: 1200,
  social: 2600,
  work: 2000,
  sacred: 1150,
  circulation: 900,
  outdoor: 1200,
}

export function validate(design: Design, options: { checkFacade?: boolean } = {}): ValidationReport {
  const findings: Finding[] = []
  const add = (
    code: string,
    severity: Severity,
    category: FindingCategory,
    message: string,
    roomId?: string,
  ) => findings.push({ code, severity, category, message, roomId })

  for (const message of validateSiteFeatures(design.model, design.floors[0], design.siteFeatures ?? [])) add('SITE_FEATURE_CONFLICT', 'error', 'geometry', message)
  const reqIndex = indexRequirements(design.model)
  // a large villa is chosen for generous rooms — an over-target room is the
  // point, not a defect, so the "exceeds maximum" advisory is suppressed
  // (a room *below* its minimum is still flagged).
  const large = design.model.brief.project.buildingType === 'large-villa'

  for (const floor of design.floors) {
    const required = design.model.floors[floor.level]?.spaces ?? []
    for (const req of required) {
      const found = floor.rooms.filter((room) => room.id === req.id)
      if (found.length !== 1) add('PROGRAMME_MISMATCH', 'error', 'planning',
        `${floor.name} requires one ${req.name.toLowerCase()}; the plan contains ${found.length}.`, req.id)
    }
    for (let i = 0; i < floor.rooms.length; i++) {
      const room = floor.rooms[i]
      if (room.rect.w <= 0 || room.rect.h <= 0 || !Number.isFinite(room.area))
        add('INVALID_ROOM_GEOMETRY', 'error', 'geometry', `${room.name} has invalid dimensions.`, room.id)
      if (room.outdoor) continue
      const pieces = floor.footprint.map((block) => ({
        x: Math.max(room.rect.x, block.x), y: Math.max(room.rect.y, block.y),
        w: Math.max(0, Math.min(rectRight(room.rect), rectRight(block)) - Math.max(room.rect.x, block.x)),
        h: Math.max(0, Math.min(rectBottom(room.rect), rectBottom(block)) - Math.max(room.rect.y, block.y)),
      })).filter((piece) => piece.w > 0 && piece.h > 0)
      const covered = pieces.length ? rectUnionArea(pieces) : 0
      if ((room.rect.w * room.rect.h - covered) > 200_000)
        add('ROOM_OUTSIDE_FOOTPRINT', 'error', 'geometry', `${room.name} extends beyond the enclosed footprint.`, room.id)
      for (let j = i + 1; j < floor.rooms.length; j++) {
        const other = floor.rooms[j]
        if (other.outdoor) continue
        const overlap = Math.max(0, Math.min(rectRight(room.rect), rectRight(other.rect)) - Math.max(room.rect.x, other.rect.x)) *
          Math.max(0, Math.min(rectBottom(room.rect), rectBottom(other.rect)) - Math.max(room.rect.y, other.rect.y))
        if (overlap > 250_000) add('ROOM_OVERLAP', 'error', 'geometry',
          `${room.name} overlaps ${other.name} by ${(overlap / 1e6).toFixed(1)} m².`, room.id)
      }
    }
    const boundary = rectUnionEdges(floor.footprint, floor.courtyard)
    for (const opening of floor.openings) {
      if (opening.kind === 'door') continue
      const matches = boundary.some((edge) => {
        const horizontal = edge.side === 'N' || edge.side === 'S'
        if ((opening.orient === 'h') !== horizontal) return false
        const fixed = horizontal ? edge.a.y : edge.a.x
        const value = horizontal ? opening.at.y : opening.at.x
        const along = horizontal ? opening.at.x : opening.at.y
        const lo = horizontal ? edge.a.x : edge.a.y
        const hi = horizontal ? edge.b.x : edge.b.y
        // The 3D wall needs an unchanged opening with a 110 mm end pier.
        // Never certify a window that the mesh builder would need to shrink.
        return Math.abs(value - fixed) < 2 &&
          along - opening.width / 2 >= lo + 110 && along + opening.width / 2 <= hi - 110
      })
      if (!matches) add('PLAN_3D_OPENING_MISMATCH', 'error', 'geometry',
        `${floor.name} has a ${opening.kind} that cannot be placed on its 3D exterior wall.`)
    }
    for (const room of floor.rooms) {
      const req = reqIndex.get(`${floor.level}:${room.id}`)
      const shortSide = Math.min(room.rect.w, room.rect.h)
      const longSide = Math.max(room.rect.w, room.rect.h)

      // --- geometry: minimum dimension ---
      const minDim = MIN_DIM[room.zone] ?? 1800
      if (shortSide < minDim) {
        const sev: Severity = room.zone === 'private' ? 'error' : 'warning'
        add(
          'MIN_ROOM_DIMENSION',
          sev,
          'geometry',
          `${room.name} is only ${(shortSide / 1000).toFixed(2)} m wide — below the ${(minDim / 1000).toFixed(1)} m concept minimum.`,
          room.id,
        )
      }

      // --- geometry: proportion (wet rooms are allowed to be tight) ---
      if (
        shortSide > 0 &&
        longSide / shortSide > 3.4 &&
        !room.outdoor &&
        room.zone !== 'service' &&
        room.zone !== 'circulation'
      ) {
        add(
          'ROOM_PROPORTION',
          'warning',
          'geometry',
          `${room.name} is long and narrow (${(longSide / shortSide).toFixed(1)} : 1).`,
          room.id,
        )
      }

      // --- planning: area vs brief target (skip code-sized circulation) ---
      if (req && !room.outdoor && room.zone !== 'circulation') {
        if (room.area < req.min - 0.4) {
          add(
            'AREA_BELOW_MINIMUM',
            'error',
            'planning',
            `${room.name} is ${room.area.toFixed(1)} m² — under its ${req.min} m² minimum.`,
            room.id,
          )
        } else if (!large && room.area > req.max + 0.4) {
          add(
            'AREA_TARGET_EXCEEDED',
            'warning',
            'planning',
            `${room.name} exceeds its warning area maximum (${room.area.toFixed(1)} m² vs ${req.max} m²).`,
            room.id,
          )
        }
      }

      // --- geometry: daylight (habitable rooms on the perimeter only) ---
      const onExterior = boundary.some((edge) => {
        const horizontal = edge.side === 'N' || edge.side === 'S'
        const fixed = horizontal ? edge.a.y : edge.a.x
        const touches = horizontal
          ? Math.abs(room.rect.y - fixed) < 3 || Math.abs(rectBottom(room.rect) - fixed) < 3
          : Math.abs(room.rect.x - fixed) < 3 || Math.abs(rectRight(room.rect) - fixed) < 3
        const overlap = horizontal
          ? Math.min(rectRight(room.rect), edge.b.x) - Math.max(room.rect.x, edge.a.x)
          : Math.min(rectBottom(room.rect), edge.b.y) - Math.max(room.rect.y, edge.a.y)
        return touches && overlap >= 1200
      })
      const habitable = room.zone === 'social' || room.zone === 'private' || room.zone === 'work'
      if (req?.wantsWindow && habitable && !room.outdoor) {
        const hasWindow = floor.openings.some(
          (o) =>
            (o.kind === 'window' || o.kind === 'door') &&
            o.at.x >= room.rect.x - 50 &&
            o.at.x <= rectRight(room.rect) + 50 &&
            o.at.y >= room.rect.y - 50 &&
            o.at.y <= rectBottom(room.rect) + 50 &&
            boundary.some((edge) => {
              const horizontal = edge.side === 'N' || edge.side === 'S'
              return (o.orient === 'h') === horizontal &&
                Math.abs((horizontal ? o.at.y : o.at.x) - (horizontal ? edge.a.y : edge.a.x)) < 450
            }),
        )
        if (!onExterior || !hasWindow) {
          add(
            'NO_DAYLIGHT',
            'error',
            'geometry',
            `${room.name} needs an exterior wall and glazed opening for daylight.`,
            room.id,
          )
        }
      }
    }

    // --- topology: reachability ---
    for (const id of floor.unreachableRooms) {
      const room = floor.rooms.find((r) => r.id === id)
      add(
        'UNREACHABLE_ROOM',
        'error',
        'topology',
        `${room?.name ?? id} on ${floor.name.toLowerCase()} cannot be reached through a valid door or stair.`,
        id,
      )
    }

    // --- planning: floor fits its envelope ---
    const usable = toSqm(design.model.envelope.width * design.model.envelope.depth) * 0.82
    const demand = floor.rooms.filter((r) => !r.outdoor).reduce((a, r) => a + r.area, 0)
    if (demand > usable) {
      add(
        'PROGRAMME_OVERFLOW',
        'warning',
        'planning',
        `${floor.name} demands ${demand.toFixed(0)} m² against ${usable.toFixed(0)} m² usable.`,
      )
    }
  }

  // --- egress: entry door ---
  const ground = design.floors[0]
  if (design.model.brief.rooms.priorities.courtyard && !ground.courtyard)
    add('COURTYARD_MISSING', 'error', 'planning',
      'A central courtyard was requested, but this footprint has no open central court. Choose a larger plot or remove that priority.')
  if (!ground.openings.some((o) => o.kind === 'entry')) {
    add('NO_ENTRY_DOOR', 'error', 'egress', 'No entry door was placed on the ground floor.')
  }

  for (const entry of ground.openings.filter(o => o.kind === 'entry')) if (entry.width < 1200 || entry.width > 1800 || (entry.head ?? 2500) < 2400)
    add('MAIN_ENTRY_SIZE', 'error', 'egress', 'The main entry must be 1.2–1.8 m wide and at least 2.4 m tall.')

  // --- vastu: strict Vastu could not be met by any valid plan (the generator
  //     prefers plans that meet it; this reports when none could) ---
  if (design.model.brief.lifestyle.vastu === 'strict') {
    const failed = strictVastuFailures(design)
    if (failed.length)
      add('VASTU_STRICT_UNMET', 'warning', 'vastu',
        `Strict Vastu was requested but no valid plan meets it: ${failed.join('; ')}.`)
  }

  // --- planning: the kitchen's connection is narrower than the brief asked for
  //     (the planner falls back open → glazed slide → door when a type won't fit) ---
  const kitchenRank = { closed: 0, semi: 1, open: 2 } as const
  const wantKitchen = design.model.brief.lifestyle.kitchen
  if (ground.rooms.some((r) => r.id === 'kitchen') && wantKitchen !== 'closed') {
    const link = ground.openings.find((o) => o.kind === 'door' && o.rooms?.includes('kitchen') &&
      (!!o.treatment || o.rooms.some((id) => id === 'dining' || id === 'livingDining')))
    const got = link?.treatment === 'open' ? 'open' : link?.treatment === 'glazed-slide' ? 'semi' : 'closed'
    if (kitchenRank[got] < kitchenRank[wantKitchen])
      add('KITCHEN_TYPE_DOWNGRADED', 'warning', 'planning',
        `A ${wantKitchen === 'open' ? 'fully open' : 'semi-open'} kitchen could not fit on the shared wall; it was built as ${got === 'semi' ? 'semi-open (glazed slide)' : 'closed (a door)'}.`, 'kitchen')
  }

  // --- planning: someone who cannot use the stairs needs a ground-floor
  //     bedroom with its own bathroom ---
  const needsGround = design.model.brief.household.members.filter((m) => m.needsGroundFloor).length
  if (needsGround > 0) {
    const groundIds = new Set(ground.rooms.map((r) => r.id))
    const groundBedWithBath = ground.rooms.some((r) => r.zone === 'private' && !r.outdoor &&
      design.model.relationships.some((rel) => rel.kind === 'adjacent' && rel.a === r.id &&
        groundIds.has(rel.b) && /^bath\d/.test(rel.b)))
    if (!groundBedWithBath)
      add('GROUND_FLOOR_BEDROOM_MISSING', 'error', 'planning',
        `${needsGround} ${needsGround === 1 ? 'member needs' : 'members need'} the ground floor, but no ground-floor bedroom has an attached bath. Add a bedroom with attached bath.`)
  }

  // --- mandatory plan validators: tiling, support, columns, beams, openings,
  //     door swings, privacy, ventilation, stair core, semantic ids ---
  for (const f of planFindings(design)) add(f.code, 'error', f.category, f.message, f.roomId)
  if (options.checkFacade !== false)
    for (const message of validateVillaVariation(design).errors)
      add('FACADE_COLLISION', 'error', 'geometry', message)

  // --- vertical: stair present & aligned ---
  if (design.floors.length > 1) {
    const stairRects = design.floors.map((f) => f.rooms.find((r) => r.id === 'stair')?.rect)
    if (stairRects.some((r) => !r)) {
      add('STAIR_MISSING', 'error', 'vertical', 'A floor is missing its stair core.')
    }
    if (design.model.brief.levels.liftProvision) {
      const lifts = design.floors.map((floor) => floor.rooms.find((room) => room.id === 'lift')?.rect)
      if (lifts.some((room) => !room))
        add('LIFT_MISSING', 'error', 'vertical', 'The requested future lift shaft is missing on a floor.')
      else if (lifts.some((room) => room && lifts[0] &&
        (room.x !== lifts[0].x || room.y !== lifts[0].y || room.w !== lifts[0].w || room.h !== lifts[0].h)))
        add('LIFT_MISALIGNED', 'error', 'vertical', 'Future lift shafts do not line up across floors.')
    }
  }

  // --- planning: site coverage ---
  if (design.coverage > PLANNING.maxCoverage) {
    add(
      'COVERAGE_EXCEEDED',
      'error',
      'planning',
      `Covered footprint is ${(design.coverage * 100).toFixed(0)}% of the plot — over the ${(PLANNING.maxCoverage * 100).toFixed(0)}% concept limit.`,
    )
  } else if (design.coverage > PLANNING.warnCoverage) {
    add(
      'COVERAGE_HIGH',
      'warning',
      'planning',
      `Covered footprint is ${(design.coverage * 100).toFixed(0)}% of the plot — check the local coverage limit.`,
    )
  }

  // --- vastu: orientation guidance (advisory only, never affects the score) ---
  vastuNotes(design, add)

  // --- geometry: setback envelope ---
  const env = design.model
  for (const floor of design.floors) {
    const o = floor.outline
    const tol = 160 // one grid module of snapping slack
    if (
      o.x < env.setbacksMm.W - tol ||
      o.y < env.setbacksMm.N - tol ||
      rectRight(o) > env.plot.width - env.setbacksMm.E + tol ||
      rectBottom(o) > env.plot.depth - env.setbacksMm.S + tol
    ) {
      add('SETBACK_BREACH', 'error', 'geometry', `${floor.name} extends past the required setback line.`)
      break
    }
  }

  const counts: Record<Severity, number> = {
    error: findings.filter((f) => f.severity === 'error').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  }
  const score = Math.max(0, Math.round(100 - counts.error * 12 - counts.warning * 4))

  return {
    pack: RULE_PACK,
    score,
    hardChecksPass: counts.error === 0,
    findings: findings.sort((a, b) => sev(a.severity) - sev(b.severity)),
    counts,
    checksRun: ['geometry', 'egress', 'topology', 'vertical', 'planning', 'vastu'],
  }
}

/* ------------------------------------------------------------------ *
 *  Vastu orientation notes — advisory only (severity 'info', zero
 *  score weight). The plan is drawn with the road/entry at plan-south;
 *  `entrySide` says which real compass direction that is, so we rotate
 *  each room's plan quadrant back to real compass bearings.
 * ------------------------------------------------------------------ */

function vastuNotes(
  design: Design,
  add: (c: string, s: Severity, cat: FindingCategory, m: string, id?: string) => void,
) {
  const ground = design.floors[0]
  if (!ground) return

  // acceptable = the ideal corner, its own edges (S / E for SE) and the two
  // neighbouring corners; anything else — including the centre — trips a note
  const OK: Record<string, string[]> = {
    SE: ['SE', 'S', 'E', 'NE', 'SW'],
    NE: ['NE', 'N', 'E', 'NW', 'SE'],
    SW: ['SW', 'S', 'W', 'SE', 'NW'],
  }
  const note = (id: string, level: number, ideal: keyof typeof OK, label: string, hint: string) => {
    const c = roomQuadrant(design, id, level)
    if (!c || OK[ideal].includes(c)) return
    add('VASTU_ORIENTATION', 'info', 'vastu', `${label} sits toward the ${compass(c)} — ${hint}`, id)
  }

  note('kitchen', 0, 'SE', 'Kitchen', 'vastu favours the south-east (agni) corner.')
  note('pooja', 0, 'NE', 'Pooja room', 'vastu favours the north-east (ishanya) corner.')
  // a room lives on one floor; the master is usually upstairs
  const masterFloor = design.model.floors.find((f) => f.spaces.some((s) => s.role === 'master'))
  const master = masterFloor?.spaces.find((s) => s.role === 'master')
  if (master && masterFloor) note(master.id, masterFloor.level, 'SW', 'Master bedroom', 'vastu favours the south-west (nairitya) corner.')

  // toilets in the north-east are the classic vastu dosha
  for (const r of ground.rooms) {
    const isToilet = r.zone === 'service' && /bath|toilet|wc/i.test(r.id + r.name)
    if (!isToilet) continue
    if (roomQuadrant(design, r.id, 0) === 'NE') {
      add('VASTU_ORIENTATION', 'info', 'vastu', `${r.name} is in the north-east — vastu treats a toilet here as a dosha.`, r.id)
    }
  }
}
const compass = (c: string): string =>
  ({ N: 'north', E: 'east', S: 'south', W: 'west', NE: 'north-east', NW: 'north-west', SE: 'south-east', SW: 'south-west', C: 'centre' })[c] ?? c

const sev = (s: Severity) => (s === 'error' ? 0 : s === 'warning' ? 1 : 2)

function indexRequirements(model: CanonicalModel): Map<string, SpaceReq> {
  const m = new Map<string, SpaceReq>()
  for (const floor of model.floors) {
    for (const s of floor.spaces) m.set(`${floor.level}:${s.id}`, s)
  }
  return m
}

/** decorative helper for the review screen's pre-flight bar */
export function programmeCapacity(model: CanonicalModel): { level: number; name: string; demand: number; usable: number; pct: number }[] {
  const groundIds = new Set(model.floors[0].spaces.map((space) => space.id))
  const frontStrip = groundIds.has('parking') ? 5500 : groundIds.has('verandah') ? 2900 : 0
  const usable = toSqm(model.envelope.width * Math.max(0, model.envelope.depth - frontStrip)) * 0.82
  return model.floors.map((f) => {
    const demand = f.spaces.filter((s) => !s.outdoor).reduce((a, s) => a + s.min, 0)
    return { level: f.level, name: f.name, demand, usable, pct: Math.round((demand / usable) * 100) }
  })
}
