import { rectRight, rectBottom, toSqm } from '../geometry.ts'
import type { CanonicalModel, SpaceReq } from '../model/canonical.ts'
import type { Design } from '../engine/types.ts'

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
const PLANNING = {
  maxCoverage: 0.6,
  warnCoverage: 0.5,
}

const MIN_DIM: Record<string, number> = {
  private: 2400,
  service: 1200,
  social: 2600,
  work: 2000,
  sacred: 1150,
  circulation: 900,
  outdoor: 1200,
}

export function validate(design: Design): ValidationReport {
  const findings: Finding[] = []
  const add = (
    code: string,
    severity: Severity,
    category: FindingCategory,
    message: string,
    roomId?: string,
  ) => findings.push({ code, severity, category, message, roomId })

  const reqIndex = indexRequirements(design.model)
  // a large villa is chosen for generous rooms — an over-target room is the
  // point, not a defect, so the "exceeds maximum" advisory is suppressed
  // (a room *below* its minimum is still flagged).
  const large = design.model.brief.project.buildingType === 'large-villa'

  for (const floor of design.floors) {
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
            'warning',
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
      const onExterior =
        Math.abs(room.rect.x - floor.outline.x) < 3 ||
        Math.abs(rectRight(room.rect) - rectRight(floor.outline)) < 3 ||
        Math.abs(room.rect.y - floor.outline.y) < 3 ||
        Math.abs(rectBottom(room.rect) - rectBottom(floor.outline)) < 3
      const habitable = room.zone === 'social' || room.zone === 'private' || room.zone === 'work'
      if (req?.wantsWindow && habitable && !room.outdoor && room.area >= 11 && onExterior) {
        const hasWindow = floor.openings.some(
          (o) =>
            o.kind === 'window' &&
            o.at.x >= room.rect.x - 50 &&
            o.at.x <= rectRight(room.rect) + 50 &&
            o.at.y >= room.rect.y - 50 &&
            o.at.y <= rectBottom(room.rect) + 50,
        )
        if (!hasWindow) {
          add(
            'NO_DAYLIGHT',
            'warning',
            'geometry',
            `${room.name} has no external window — it is landlocked in this scheme.`,
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
  if (!ground.openings.some((o) => o.kind === 'entry')) {
    add('NO_ENTRY_DOOR', 'error', 'egress', 'No entry door was placed on the ground floor.')
  }

  // --- vertical: every upper storey must be carried by the one below it ---
  for (let i = 1; i < design.floors.length; i++) {
    const upper = design.floors[i].footprint ?? [design.floors[i].outline]
    const lower = design.floors[i - 1].footprint ?? [design.floors[i - 1].outline]
    const upArea = upper.reduce((a, b) => a + b.w * b.h, 0)
    let carried = 0
    for (const u of upper) {
      for (const l of lower) {
        const ox = Math.max(0, Math.min(rectRight(u), rectRight(l)) - Math.max(u.x, l.x))
        const oy = Math.max(0, Math.min(rectBottom(u), rectBottom(l)) - Math.max(u.y, l.y))
        carried += ox * oy
      }
    }
    if (upArea > 0 && carried / upArea < 0.55) {
      add(
        'FLOOR_STACKING',
        'error',
        'vertical',
        `${design.floors[i].name} is only ${Math.round((carried / upArea) * 100)}% supported by the storey below — an unbuildable overhang.`,
      )
    }
  }

  // --- vertical: stair present & aligned ---
  if (design.floors.length > 1) {
    const stairRects = design.floors.map((f) => f.rooms.find((r) => r.id === 'stair')?.rect)
    if (stairRects.some((r) => !r)) {
      add('STAIR_MISSING', 'error', 'vertical', 'A floor is missing its stair core.')
    } else {
      const [base, ...rest] = stairRects
      const aligned = rest.every(
        (r) => r && base && Math.abs(r.x - base.x) < 150 && Math.abs(r.y - base.y) < 150,
      )
      if (!aligned) {
        add('STAIR_MISALIGNED', 'error', 'vertical', 'The stair core is not vertically aligned across floors.')
      }
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

const ROTATE: Record<string, Record<string, string>> = {
  S: { N: 'N', E: 'E', S: 'S', W: 'W' },
  N: { N: 'S', E: 'W', S: 'N', W: 'E' },
  E: { N: 'W', E: 'N', S: 'E', W: 'S' },
  W: { N: 'E', E: 'S', S: 'W', W: 'N' },
}

function vastuNotes(
  design: Design,
  add: (c: string, s: Severity, cat: FindingCategory, m: string, id?: string) => void,
) {
  const ground = design.floors[0]
  if (!ground) return
  const rot = ROTATE[design.model.entrySide] ?? ROTATE.S
  const o = ground.outline
  const cx = o.x + o.w / 2
  const cy = o.y + o.h / 2

  /** real-compass corner of a room's centroid, always ordered N/S then E/W */
  const corner = (r: { rect: { x: number; y: number; w: number; h: number } }): string => {
    const rx = r.rect.x + r.rect.w / 2
    const ry = r.rect.y + r.rect.h / 2
    const a = rot[ry < cy ? 'N' : 'S']
    const b = rot[rx < cx ? 'W' : 'E']
    const ns = a === 'N' || a === 'S' ? a : b === 'N' || b === 'S' ? b : ''
    const ew = a === 'E' || a === 'W' ? a : b === 'E' || b === 'W' ? b : ''
    return ns + ew
  }

  // acceptable = the ideal corner plus its two axis-neighbours; only the
  // opposite corner trips a note.
  const OK: Record<string, string[]> = {
    SE: ['SE', 'NE', 'SW'],
    NE: ['NE', 'NW', 'SE'],
    SW: ['SW', 'SE', 'NW'],
  }
  const note = (id: string, ideal: keyof typeof OK, label: string, hint: string) => {
    const room = ground.rooms.find((r) => r.id === id)
    if (!room) return
    const c = corner(room)
    if (OK[ideal].includes(c)) return
    add('VASTU_ORIENTATION', 'info', 'vastu', `${label} sits toward the ${compass(c)} — ${hint}`, id)
  }

  note('kitchen', 'SE', 'Kitchen', 'vastu favours the south-east (agni) corner.')
  note('pooja', 'NE', 'Pooja room', 'vastu favours the north-east (ishanya) corner.')
  note('bed1', 'SW', 'Master bedroom', 'vastu favours the south-west (nairitya) corner.')

  // toilets in the north-east are the classic vastu dosha
  for (const r of ground.rooms) {
    const isToilet = r.zone === 'service' && /bath|toilet|wc/i.test(r.id + r.name)
    if (!isToilet) continue
    if (corner(r) === 'NE') {
      add('VASTU_ORIENTATION', 'info', 'vastu', `${r.name} is in the north-east — vastu treats a toilet here as a dosha.`, r.id)
    }
  }
}

const compass = (c: string): string =>
  ({ N: 'north', E: 'east', S: 'south', W: 'west', NE: 'north-east', NW: 'north-west', SE: 'south-east', SW: 'south-west' })[c] ?? c

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
  const usable = toSqm(model.envelope.width * model.envelope.depth) * 0.82
  return model.floors.map((f) => {
    const demand = f.spaces.filter((s) => !s.outdoor).reduce((a, s) => a + s.min, 0)
    return { level: f.level, name: f.name, demand, usable, pct: Math.round((demand / usable) * 100) }
  })
}
