import { rectArea, rectBottom, rectRight, type Point, type Rect } from '../geometry.ts'
import type { Design, FloorPlan, Opening } from '../engine/types.ts'
import { MAX_BEAM_SPAN } from '../engine/planner/program.ts'

/* Deterministic checks of a plan against the structure that is already built. Pure geometry and the
 * programme's own minimums: no AI, no guessing. Each finding says where it is so the plan view can mark it red. */

export type ExistingFinding = {
  code: string
  severity: 'error' | 'warning'
  message: string
  level: number
  at?: Point
}
export type ExistingReport = { findings: ExistingFinding[]; errors: number; warnings: number; ok: boolean }

const overlap = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), w = Math.min(rectRight(a), rectRight(b)) - x, h = Math.min(rectBottom(a), rectBottom(b)) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}
const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
const wallRect = (w: FloorPlan['walls'][number]): Rect => {
  const horizontal = Math.abs(w.a.y - w.b.y) < 2
  return horizontal
    ? { x: Math.min(w.a.x, w.b.x), y: w.a.y - w.thickness / 2, w: Math.abs(w.a.x - w.b.x), h: w.thickness }
    : { x: w.a.x - w.thickness / 2, y: Math.min(w.a.y, w.b.y), w: w.thickness, h: Math.abs(w.a.y - w.b.y) }
}
const colRect = (c: { at: Point; size: number }): Rect => ({ x: c.at.x - c.size / 2, y: c.at.y - c.size / 2, w: c.size, h: c.size })
const line = (o: Opening) => (o.orient === 'h' ? o.at.y : o.at.x)
const along = (o: Opening) => (o.orient === 'h' ? o.at.x : o.at.y)

export function validateExisting(design: Design): ExistingReport {
  const out: ExistingFinding[] = []
  const add = (code: string, severity: 'error' | 'warning', message: string, level: number, at?: Point) => out.push({ code, severity, message, level, at })
  const meta = design.existingStructure
  if (!meta) return { findings: [], errors: 0, warnings: 0, ok: true }
  const { structure, dx, dy } = meta
  const ground = design.floors[0]
  for(const wall of structure.walls) {
    const a={x:wall.a.x+dx,y:wall.a.y+dy},b={x:wall.b.x+dx,y:wall.b.y+dy}
    const same=(p:Point,q:Point)=>Math.hypot(p.x-q.x,p.y-q.y)<2
    if(!ground.walls.some(w=>w.thickness===wall.thickness&&((same(w.a,a)&&same(w.b,b))||(same(w.a,b)&&same(w.b,a)))))add('LOCKED_WALL_CHANGED','error',`Existing wall ${wall.id} was moved, resized or dropped.`,0,a)
    for(const room of ground.rooms.filter(r=>!r.outdoor)) {
      const horizontal=Math.abs(a.y-b.y)<2
      const cuts=horizontal?a.y>room.rect.y+2&&a.y<rectBottom(room.rect)-2&&Math.min(Math.max(a.x,b.x),rectRight(room.rect))-Math.max(Math.min(a.x,b.x),room.rect.x)>100:b.x>room.rect.x+2&&b.x<rectRight(room.rect)-2&&Math.min(Math.max(a.y,b.y),rectBottom(room.rect))-Math.max(Math.min(a.y,b.y),room.rect.y)>100
      if(cuts)add('LOCKED_WALL_ROOM_CONFLICT','error',`Existing wall ${wall.id} cuts through ${room.name}. Correct the room tracing or try another arrangement.`,0,a)
    }
  }

  // ---- LOCKED elements are exactly where and what they were ----
  for (const c of structure.columns) {
    const at = { x: c.at.x + dx, y: c.at.y + dy }
    const found = (ground.columns ?? []).find((d) => d.state === 'LOCKED' && Math.abs(d.at.x - at.x) < 1 && Math.abs(d.at.y - at.y) < 1 && d.size === c.size)
    if (!found && structure.storeysBuilt > 0) add('LOCKED_COLUMN_CHANGED', 'error', `Built column ${c.id} was moved, resized or dropped.`, 0, at)
  }
  for (const b of structure.beams) {
    const a = { x: b.a.x + dx, y: b.a.y + dy }, e = { x: b.b.x + dx, y: b.b.y + dy }
    const near = (p: Point, q: Point) => Math.abs(p.x - q.x) < 260 && Math.abs(p.y - q.y) < 260
    const found = (ground.beams ?? []).some((d) => d.state === 'LOCKED' && ((near(d.a, a) && near(d.b, e)) || (near(d.a, e) && near(d.b, a))))
    if (!found && structure.storeysBuilt > 0) add('LOCKED_BEAM_CHANGED', 'error', `Built beam ${b.id} is missing from the plan.`, 0, { x: (a.x + e.x) / 2, y: (a.y + e.y) / 2 })
  }

  for (const floor of design.floors) {
    const lv = floor.level
    const enclosed = floor.rooms.filter((r) => !r.outdoor)

    // ---- room overlaps ----
    for (let i = 0; i < enclosed.length; i++) for (let j = i + 1; j < enclosed.length; j++) {
      const o = overlap(enclosed[i].rect, enclosed[j].rect)
      if (o && rectArea(o) > 10000) add('ROOM_OVERLAP', 'error', `${enclosed[i].name} overlaps ${enclosed[j].name}.`, lv, centre(o))
    }

    // ---- columns against walls and rooms ----
    const walls = floor.walls.map((w) => ({ w, rect: wallRect(w) }))
    for (const c of floor.columns ?? []) {
      const r = colRect(c)
      const onWall = walls.some(({ w, rect }) => {
        if (!overlap(r, rect)) return false
        const horizontal = Math.abs(w.a.y - w.b.y) < 2
        const off = horizontal ? Math.abs(c.at.y - w.a.y) : Math.abs(c.at.x - w.a.x)
        return off <= w.thickness / 2 + 30
      })
      const cutting = walls.some(({ w, rect }) => {
        if (!overlap(r, rect)) return false
        const horizontal = Math.abs(w.a.y - w.b.y) < 2
        const off = horizontal ? Math.abs(c.at.y - w.a.y) : Math.abs(c.at.x - w.a.x)
        return off > w.thickness / 2 + 30
      })
      if (cutting) add('COLUMN_WALL_CONFLICT', 'error', `A wall runs through the edge of column ${c.id} instead of along its centre.`, lv, c.at)
      else if (!onWall) {
        const inside = enclosed.find((room) => c.at.x > room.rect.x + c.size && c.at.x < rectRight(room.rect) - c.size && c.at.y > room.rect.y + c.size && c.at.y < rectBottom(room.rect) - c.size)
        if (inside) add('COLUMN_IN_ROOM', 'warning', `Built column ${c.id} stands inside ${inside.name}. Plan a pilaster, shelf or partition around it.`, lv, c.at)
      }
    }
    for (const b of floor.beams ?? []) if (b.span > MAX_BEAM_SPAN) add('BEAM_SPAN_EXCEEDED', 'error', `Beam ${b.id} spans ${b.span} mm, over the ${MAX_BEAM_SPAN} mm limit.`, lv, { x: (b.a.x + b.b.x) / 2, y: (b.a.y + b.b.y) / 2 })

    // ---- doors and windows against columns and each other ----
    const ops = floor.openings
    for (const o of ops) {
      const half = o.width / 2
      for (const c of floor.columns ?? []) {
        const onLine = (o.orient === 'h' ? Math.abs(c.at.y - o.at.y) : Math.abs(c.at.x - o.at.x)) < c.size / 2 + 115
        const reach = (o.orient === 'h' ? c.at.x : c.at.y)
        if (onLine && reach + c.size / 2 > along(o) - half + 20 && reach - c.size / 2 < along(o) + half - 20)
          add('OPENING_COLUMN_CONFLICT', 'error', `${o.id ?? 'An opening'} runs into column ${c.id}.`, lv, o.at)
      }
    }
    for (let i = 0; i < ops.length; i++) for (let j = i + 1; j < ops.length; j++) {
      const a = ops[i], b = ops[j]
      if (a.orient === b.orient && Math.abs(line(a) - line(b)) < 2 && Math.abs(along(a) - along(b)) < (a.width + b.width) / 2 - 20)
        add('OPENING_CONFLICT', 'error', `${a.id ?? 'An opening'} overlaps ${b.id ?? 'another opening'}.`, lv, a.at)
    }

    // ---- minimum sizes, ventilation, circulation ----
    const spaces = design.model.floors[lv]?.spaces ?? []
    for (const r of enclosed) {
      const space = spaces.find((s) => s.id === r.id)
      if (space && r.zone !== 'circulation' && space.min > 0 && r.area < space.min - 0.05)
        add('ROOM_TOO_SMALL', 'error', `${r.name} is ${r.area.toFixed(1)} m², under its ${space.min} m² minimum.`, lv, centre(r.rect))
      if (r.wantsWindow && !ops.some((o) => o.kind === 'window' && o.rooms?.includes(r.id)))
        add('NO_VENTILATION', design.existingStructure?.structure.measuredPlan ? 'warning' : 'error', `${r.name} has no window for light and ventilation.`, lv, centre(r.rect))
    }
    if (!floor.reachable) for (const id of floor.unreachableRooms) add('UNREACHABLE_ROOM', 'error', `${floor.rooms.find((r) => r.id === id)?.name ?? id} cannot be reached through a door.`, lv, floor.rooms.find((r) => r.id === id) ? centre(floor.rooms.find((r) => r.id === id)!.rect) : undefined)
    const spine = floor.rooms.find((r) => r.zone === 'circulation' && !['stair', 'foyer'].includes(r.id))
    if (spine && Math.min(spine.rect.w, spine.rect.h) < 1000) add('CORRIDOR_TOO_NARROW', 'error', `The passage is only ${Math.min(spine.rect.w, spine.rect.h)} mm wide.`, lv, centre(spine.rect))
  }

  // ---- stair connectivity between floors ----
  if (design.floors.length > 1) {
    const stairs = design.floors.map((f) => f.rooms.find((r) => r.id === 'stair'))
    stairs.forEach((s, i) => {
      const f = design.floors[i]
      if (!s) { add('STAIR_MISSING', 'error', `${f.name} has no stair.`, f.level); return }
      if (!f.openings.some((o) => o.kind !== 'window' && o.rooms?.includes('stair'))) add('STAIR_NOT_CONNECTED', 'error', `The stair on ${f.name} has no door to the passage.`, f.level, centre(s.rect))
    })
    const base = stairs[0]
    if (base && stairs.some((s) => s && (s.rect.x !== base.rect.x || s.rect.y !== base.rect.y || s.rect.w !== base.rect.w || s.rect.h !== base.rect.h)))
      add('STAIR_MISALIGNED', 'error', 'The stair is not in the same place on every floor.', 0, base ? centre(base.rect) : undefined)
  }

  // ---- compatibility with what is built ----
  const gx = ground.columns?.filter((c) => c.state === 'LOCKED') ?? []
  if (gx.length) {
    const box = { x: Math.min(...gx.map((c) => c.at.x)) - 300, y: Math.min(...gx.map((c) => c.at.y)) - 300, w: 0, h: 0 }
    box.w = Math.max(...gx.map((c) => c.at.x)) + 300 - box.x; box.h = Math.max(...gx.map((c) => c.at.y)) + 300 - box.y
    for (const r of ground.rooms.filter((x) => !x.outdoor)) {
      const o = overlap(r.rect, box)
      if (!o || rectArea(o) < rectArea(r.rect) * 0.98) add('OUTSIDE_STRUCTURE', 'warning', `${r.name} extends past the built structure and would need new foundations.`, 0, centre(r.rect))
    }
  }
  const errors = out.filter((f) => f.severity === 'error').length
  return { findings: out, errors, warnings: out.length - errors, ok: errors === 0 }
}
