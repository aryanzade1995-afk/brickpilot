/* ------------------------------------------------------------------ *
 *  architecturalValidator — the §14 audit.
 *
 *      auditArchitecture(spec, design)
 *        → { valid, score, errors, warnings, repairs, attempts }
 *
 *  Major errors (missing entrance, unreachable room, floating column /
 *  slab / roof, unsupported balcony, window without a room, door
 *  without a wall, stairs that don't connect, facade element with no
 *  anchor) make `valid` false — generateDesign() then regenerates with
 *  a new seed and keeps the best-scoring attempt.
 *
 *  Everything is checked against the plot + the resolved structure, so
 *  the model has to make architectural sense with all materials and
 *  decoration stripped away.
 * ------------------------------------------------------------------ */

import type { Point, Rect } from '../../lib/geometry.ts'
import { rectArea, rectBottom, rectRight } from '../../lib/geometry.ts'
import type { Design } from '../../lib/engine/types.ts'
import { CLEARANCE, STAIR, STRUCTURE, WINDOW } from '../dims.ts'
import type { ArchIssue, ArchitecturalAudit, DesignSpec, Direction4, RoomClass } from '../types.ts'

const HABITABLE: Set<RoomClass> = new Set<RoomClass>(['living', 'dining', 'kitchen', 'bedroom', 'master', 'study'])
const WET: Set<RoomClass> = new Set<RoomClass>(['bathroom', 'kitchen', 'utility'])

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const wallLen = (w: { a: Point; b: Point }) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
const wallMid = (w: { a: Point; b: Point }): Point => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 })
const onEdge = (r: Rect, p: Point, tol = 250) => {
  const nx = Math.abs(p.x - r.x) < tol || Math.abs(p.x - rectRight(r)) < tol
  const ny = Math.abs(p.y - r.y) < tol || Math.abs(p.y - rectBottom(r)) < tol
  const ix = p.x >= r.x - tol && p.x <= rectRight(r) + tol
  const iy = p.y >= r.y - tol && p.y <= rectBottom(r) + tol
  return (nx && iy) || (ny && ix)
}

export function auditArchitecture(spec: DesignSpec, design: Design): ArchitecturalAudit {
  const E: ArchIssue[] = []
  const W: ArchIssue[] = []
  const repairs: string[] = []
  const err = (code: string, message: string, subject?: string) => E.push({ code, severity: 'error', message, subject })
  const warn = (code: string, message: string, subject?: string) => W.push({ code, severity: 'warning', message, subject })

  const ground = spec.floors.find((f) => f.level === 0)
  const topLevel = Math.max(...spec.floors.map((f) => f.level))

  /* ---- 1. ENTRANCE (§2, §8) --------------------------------------- */
  const entries = (ground?.doors ?? []).filter((d) => d.kind === 'entry')
  if (entries.length === 0) err('no-entrance', 'no entrance door on the ground floor')
  else if (entries.length > 1) warn('multi-entrance', `${entries.length} entrance doors`)
  const opposite: Record<Direction4, Direction4> = { N: 'S', S: 'N', E: 'W', W: 'E' }
  for (const e of entries) {
    if (e.side === opposite[spec.entrySide]) warn('entrance-side', `entrance faces ${e.side}, opposite the entry side ${spec.entrySide}`, e.id)
    const room = ground?.rooms.find((r) => r.id === e.roomId)
    if (!room) err('entrance-room', `entrance ${e.id} has no host room`, e.id)
    else {
      const cls = room.class
      if (!['foyer', 'living', 'lobby'].includes(cls)) warn('entrance-room-type', `entrance opens into ${cls}, not a foyer / living / lobby`, e.id)
    }
  }

  /* ---- 2. REACHABILITY (§1) ------------------------------------- */
  for (const fl of design.floors) {
    if (!fl.reachable) err('unreachable', `${fl.name}: rooms unreachable — ${fl.unreachableRooms.join(', ')}`)
  }

  /* ---- 3. DOORS (§2, §13) -------------------------------------- */
  for (const fl of spec.floors) {
    for (const d of fl.doors) {
      const room = fl.rooms.find((r) => r.id === d.roomId)
      if (!room) {
        err('door-no-room', `door ${d.id} has no room`, d.id)
        continue
      }
      if (d.kind !== 'entry' && !onEdge(room.rect, wallMid(d.wall))) {
        err('door-off-wall', `door ${d.id} is not on a wall of ${d.roomId}`, d.id)
      }
      // door ↔ column — a column landing inside the clear door opening
      const dm = wallMid(d.wall)
      const horiz = d.side === 'N' || d.side === 'S'
      const col = fl.columns.find((c) => {
        if (c.role === 'porch' || c.role === 'verandah') return false
        const along = horiz ? Math.abs(c.at.x - dm.x) : Math.abs(c.at.y - dm.y)
        const perp = horiz ? Math.abs(c.at.y - dm.y) : Math.abs(c.at.x - dm.x)
        return perp < 200 && along + c.sizeMm[0] / 2 < d.widthMm / 2 - 50
      })
      if (col) warn('door-column', `column ${col.id} sits in door ${d.id}`, d.id)
    }
    // door ↔ door — two doors genuinely overlapping on the same wall
    for (let i = 0; i < fl.doors.length; i++) {
      for (let j = i + 1; j < fl.doors.length; j++) {
        const a = fl.doors[i]
        const b = fl.doors[j]
        if (a.side !== b.side || a.roomId !== b.roomId) continue
        const ma = wallMid(a.wall)
        const mb = wallMid(b.wall)
        const horiz = a.side === 'N' || a.side === 'S'
        const perp = horiz ? Math.abs(ma.y - mb.y) : Math.abs(ma.x - mb.x)
        const along = horiz ? Math.abs(ma.x - mb.x) : Math.abs(ma.y - mb.y)
        if (perp < 120 && along < a.widthMm / 2 + b.widthMm / 2) {
          warn('door-door', `doors ${a.id} + ${b.id} overlap`, a.id)
        }
      }
    }
  }

  /* ---- 4. WINDOWS (§3, §12, §13) ------------------------------- */
  for (const fl of spec.floors) {
    const roomById = new Map(fl.rooms.map((r) => [r.id, r]))
    const winArea = new Map<string, number>()
    const perRoom = new Map<string, number>()
    // a balcony / entry door is a glazed opening — it counts toward light + vent
    for (const d of fl.doors) {
      if (d.kind !== 'balcony' && d.kind !== 'entry' && d.kind !== 'court') continue
      winArea.set(d.roomId, (winArea.get(d.roomId) ?? 0) + (d.widthMm * Math.min(d.heightMm, 2400)) / 1e6)
    }
    for (const w of fl.windows) {
      const room = roomById.get(w.roomId)
      if (!room) {
        err('win-no-room', `window ${w.id} has no room`, w.id)
        continue
      }
      perRoom.set(w.roomId, (perRoom.get(w.roomId) ?? 0) + 1)
      winArea.set(w.roomId, (winArea.get(w.roomId) ?? 0) + (w.widthMm * w.heightMm) / 1e6)
      const len = wallLen(w.wall)
      if (w.widthMm > len + 5) err('win-wider-wall', `window ${w.id} wider than its wall`, w.id)
      if (w.centerMm - w.widthMm / 2 < WINDOW.minCornerOffsetMm - 80 || w.centerMm + w.widthMm / 2 > len - WINDOW.minCornerOffsetMm + 80) {
        warn('win-corner', `window ${w.id} runs into a corner`, w.id)
      }
      // window ↔ door
      const wc = pointAlongWall(w.wall, w.centerMm)
      for (const d of fl.doors) {
        const dc = wallMid(d.wall)
        const horiz = Math.abs(w.wall.b.y - w.wall.a.y) < Math.abs(w.wall.b.x - w.wall.a.x)
        const perp = horiz ? Math.abs(dc.y - wc.y) : Math.abs(dc.x - wc.x)
        const along = horiz ? Math.abs(dc.x - wc.x) : Math.abs(dc.y - wc.y)
        if (perp < 250 && along < d.widthMm / 2 + w.widthMm / 2 + WINDOW.minDoorDistanceMm) {
          warn('win-door', `window ${w.id} clashes with door ${d.id}`, w.id)
        }
      }
      // window ↔ column — a column landing inside the opening on the same wall
      const wHoriz = Math.abs(w.wall.b.y - w.wall.a.y) < Math.abs(w.wall.b.x - w.wall.a.x)
      for (const c of fl.columns) {
        if (c.role === 'porch' || c.role === 'verandah') continue
        const along = wHoriz ? Math.abs(c.at.x - wc.x) : Math.abs(c.at.y - wc.y)
        const perp = wHoriz ? Math.abs(c.at.y - wc.y) : Math.abs(c.at.x - wc.x)
        if (perp < 250 && along < w.widthMm / 2 - c.sizeMm[0] / 2 - WINDOW.minColumnDistanceMm) {
          warn('win-column', `column ${c.id} sits in window ${w.id}`, w.id)
          break
        }
      }
    }
    // §12 light + ventilation: window area ≥ 10% of the room floor area (NBC 2016)
    for (const r of fl.rooms) {
      if (!HABITABLE.has(r.class) || r.outdoor) continue
      const has = (winArea.get(r.id) ?? 0) > 0
      const areaSqm = rectArea(r.rect) / 1e6
      const ratio = (winArea.get(r.id) ?? 0) / Math.max(areaSqm, 1)
      // a private room MUST have a glazed opening (window OR balcony door); a
      // central living / dining hub may be lit indirectly — note only
      const hasGlazedDoor = fl.doors.some((d) => d.roomId === r.id && (d.kind === 'balcony' || d.kind === 'court'))
      if (!has && !hasGlazedDoor) {
        if (r.class === 'bedroom' || r.class === 'master' || r.class === 'study' || r.class === 'kitchen') {
          warn('room-no-window', `${r.id} (${fl.name}): ${r.class} with no window or balcony door`, r.id)
        }
      } else if (has && ratio < WINDOW.minLightVentRatio - 0.03) {
        warn('light-vent', `${r.id} (${fl.name}): glazing ${(ratio * 100).toFixed(0)}% of floor (< ${WINDOW.minLightVentRatio * 100}% NBC)`, r.id)
      }
    }
    for (const [rid, n] of perRoom) if (n > WINDOW.maxPerRoom) warn('excess-windows', `${rid}: ${n} windows`, rid)
  }

  /* ---- 5. COLUMNS / STRUCTURE (§4, §5, §10) -------------------- */
  for (const fl of spec.floors) {
    const transfers = fl.beams.filter((bm) => bm.role === 'transfer')
    const belowBlocks = spec.floors.find((f) => f.level === fl.level - 1)?.blocks ?? []
    for (const c of fl.columns) {
      if (c.level === 0 || c.role === 'porch' || c.role === 'verandah') continue
      if (c.alignedBelow) continue
      const carriedByTransfer = transfers.some((bm) => pointNearSeg(c.at, bm.a, bm.b, 1200) || dist(bm.a, c.at) < 1200 || dist(bm.b, c.at) < 1200)
      // over the storey below's slab, or within a legit cantilever of its edge
      const nearestEdge = Math.min(
        Infinity,
        ...belowBlocks.map((b) => {
          const dx = Math.max(b.rect.x - c.at.x, 0, c.at.x - rectRight(b.rect))
          const dy = Math.max(b.rect.y - c.at.y, 0, c.at.y - rectBottom(b.rect))
          return Math.hypot(dx, dy)
        }),
      )
      const onCantilever = nearestEdge <= STRUCTURE.maxSlabCantileverMm + 100
      if (carriedByTransfer || nearestEdge < 50 || onCantilever) {
        repairs.push(`${c.id}: carried on ${carriedByTransfer ? 'a transfer beam' : nearestEdge < 50 ? 'the slab below' : 'a cantilever'}`)
      } else {
        err('floating-column', `column ${c.id} is ${nearestEdge | 0}mm past the structure below with no transfer beam`, c.id)
      }
    }
    // every slab level present
    if (fl.slabs.length === 0) err('no-slab', `${fl.name}: no floor slab`)
    for (const s of fl.slabs) {
      const cant = Math.max(0, ...Object.values(s.cantilever))
      if (s.supports.startsWith('balcony') || s.supports === 'canopy') continue
      const block = fl.blocks.find((b) => overlap(b.rect, s.rect) > rectArea(s.rect) * 0.4)
      if (!block) err('floating-slab', `slab ${s.id} is not carried by any block`, s.id)
      if (cant > CLEARANCE.roofToBuildingMm + 1800) warn('slab-cantilever', `slab ${s.id} cantilevers ${cant | 0}mm`, s.id)
    }
  }
  const hasRoofSlab = spec.floors.some((f) => f.slabs.some((s) => s.level === topLevel + 1))
  if (!hasRoofSlab) warn('no-roof-slab', 'no roof slab')

  /* ---- 6. BALCONIES (§6) ------------------------------------- */
  for (const fl of spec.floors) {
    for (const b of fl.balconies) {
      const room = fl.rooms.find((r) => r.id === b.roomId)
      if (!room) {
        err('balcony-no-room', `balcony ${b.id} has no room`, b.id)
        continue
      }
      // a door onto the balcony (balcony/court door, or any door near the host wall)
      const bc = { x: b.rect.x + b.rect.w / 2, y: b.rect.y + b.rect.h / 2 }
      const door = fl.doors.find((d) => (d.kind === 'balcony' || d.kind === 'court') && dist(wallMid(d.wall), bc) < 4000) ??
        fl.doors.find((d) => dist(wallMid(d.wall), bc) < 3000)
      if (!door) warn('balcony-no-door', `balcony ${b.id} has no balcony door`, b.id)
      // support: recessed (carved), or a slab with a column / acceptable cantilever
      if (!b.recessed && b.depthMm > 1800) {
        const col = fl.columns.some((c) => (c.role === 'verandah' || c.role === 'porch') && dist(c.at, bc) < b.depthMm + 1000)
        if (!col) err('balcony-unsupported', `balcony ${b.id} projects ${b.depthMm}mm with no column`, b.id)
      }
    }
  }

  /* ---- 7. STAIRS (§7) --------------------------------------- */
  if (spec.floors.length > 1) {
    for (const fl of spec.floors) {
      if (fl.level >= topLevel) continue
      const st = fl.stairs[0]
      if (!st) {
        err('no-stair', `${fl.name}: no stair to the floor above`)
        continue
      }
      const nextBase = (fl.level + 1) * fl.heightMm
      if (Math.abs(st.toMm - nextBase) > 50) err('stair-disconnect', `stair ${st.id} does not reach the next floor`, st.id)
      if (st.treadMm < STAIR.treadMm - 25) warn('stair-tread', `stair ${st.id} tread ${st.treadMm}mm < ${STAIR.treadMm}`, st.id)
      if (st.riserMm > 190) warn('stair-riser', `stair ${st.id} riser ${st.riserMm}mm > 190 NBC`, st.id)
      if (st.widthMm < STAIR.minWidthMm - 50) warn('stair-width', `stair ${st.id} width ${st.widthMm}mm < ${STAIR.minWidthMm}`, st.id)
      if (st.headroomMm < STAIR.minHeadroomMm) warn('stair-headroom', `stair ${st.id} headroom ${st.headroomMm}mm < 2100`, st.id)
      if (st.steps > STAIR.maxRisersPerFlight && st.flights < 2) warn('stair-landing', `stair ${st.id}: ${st.steps} risers need a landing`, st.id)
      // stair ↔ door — a door leaf swinging INTO the stair run (not the stair's
      // own access door, which sits on the boundary)
      for (const d of fl.doors) {
        if (d.kind === 'entry' || d.roomId === 'stair') continue
        if (pointInRect(wallMid(d.wall), st.rect, -Math.min(d.widthMm, 700))) {
          warn('stair-door', `door ${d.id} opens into stair ${st.id}`, st.id)
        }
      }
    }
  }

  /* ---- 8. ROOF (§13) --------------------------------------- */
  for (const fl of spec.floors) {
    for (const b of fl.blocks) {
      if (b.level !== topLevel) continue
      if (!b.roof) err('floating-roof', `block ${b.id} has no roof`, b.id)
      else if (b.roof.pitchDeg < 0 || b.roof.pitchDeg > 45) warn('roof-pitch', `${b.id} roof pitch ${b.roof.pitchDeg}°`, b.id)
    }
  }

  /* ---- 9. FACADE ANCHORING (§9) --------------------------- */
  const blockIds = new Set(spec.floors.flatMap((f) => f.blocks.map((b) => b.id)))
  const winIds = new Set(spec.floors.flatMap((f) => f.windows.map((w) => w.id)))
  const doorIds = new Set(spec.floors.flatMap((f) => f.doors.map((d) => d.id)))
  const colIds = new Set(spec.floors.flatMap((f) => f.columns.map((c) => c.id)))
  for (const el of spec.facade) {
    const a = el.anchor
    if (!a) {
      err('facade-unanchored', `facade ${el.kind} has no anchor`, el.kind)
      continue
    }
    const ok =
      (a.on === 'block' && blockIds.has(a.id)) ||
      (a.on === 'window' && winIds.has(a.id)) ||
      (a.on === 'door' && doorIds.has(a.id)) ||
      (a.on === 'column' && a.ids.every((id) => colIds.has(id))) ||
      (a.on === 'stair' && spec.floors.some((f) => f.level === a.level && f.stairs.length > 0)) ||
      (a.on === 'roof' && blockIds.has(a.blockId))
    if (!ok) err('facade-bad-anchor', `facade ${el.kind} anchors to a missing ${a.on}`, el.kind)
  }

  /* ---- 10. PLUMBING (§11) — prefer stacked wet areas ------- */
  for (let L = 1; L <= topLevel; L++) {
    const upper = spec.floors.find((f) => f.level === L)
    const lower = spec.floors.find((f) => f.level === L - 1)
    if (!upper || !lower) continue
    const lowerWet = lower.rooms.filter((r) => WET.has(r.class) && !r.outdoor)
    if (lowerWet.length === 0) continue
    const upWet = upper.rooms.filter((r) => WET.has(r.class) && !r.outdoor)
    // only flag when NONE of the upstairs wet rooms land over a downstairs wet room
    const anyStacked = upWet.some((ur) => {
      const uc = { x: ur.rect.x + ur.rect.w / 2, y: ur.rect.y + ur.rect.h / 2 }
      return lowerWet.some((lr) => dist(uc, { x: lr.rect.x + lr.rect.w / 2, y: lr.rect.y + lr.rect.h / 2 }) < 3500)
    })
    if (upWet.length > 0 && !anyStacked) {
      warn('plumbing-stack', `${upper.name}: no wet area stacks over the floor below`, upper.name)
    }
  }

  const score = Math.max(0, Math.min(100, 100 - 12 * E.length - 3 * W.length))
  return { valid: E.length === 0, score, errors: E, warnings: W, repairs, attempts: 0 }
}

/* ---- geometry helpers ---------------------------------------- */

function pointAlongWall(w: { a: Point; b: Point }, mm: number): Point {
  const dx = w.b.x - w.a.x
  const dy = w.b.y - w.a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: w.a.x + (dx / len) * mm, y: w.a.y + (dy / len) * mm }
}
function overlap(a: Rect, b: Rect): number {
  const w = Math.max(0, Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x))
  const h = Math.max(0, Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y))
  return w * h
}
function pointInRect(p: Point, r: Rect, pad: number): boolean {
  return p.x >= r.x - pad && p.x <= rectRight(r) + pad && p.y >= r.y - pad && p.y <= rectBottom(r) + pad
}
function pointNearSeg(p: Point, a: Point, b: Point, tol: number): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy || 1
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) < tol
}
