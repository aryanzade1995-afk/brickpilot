import type { Design } from '../engine/types.ts'
import { edgeIsExterior, rectBottom, rectRight } from '../geometry.ts'
import { THEMES, type Character } from '../model/themes.ts'

/* ------------------------------------------------------------------ *
 *  buildRoom — a clean architectural shell of ONE room, seen from
 *  inside, for the AI interior render. Pure function of the Design.
 *
 *  Floor + ceiling + four walls carrying this room's real doors and
 *  windows at their real sill / head heights, plus a camera pose that
 *  frames the wall with the main window. No furniture — the prompt
 *  describes that; the depth / edge maps hold the geometry.
 * ------------------------------------------------------------------ */

export type RoomMatKey = 'wall' | 'slab' | 'ceil' | 'glass' | 'reveal' | 'trim'

export type RoomBox = {
  id: string
  mat: RoomMatKey
  /** local metres, room centred on the origin, y up, x east, z south */
  pos: [number, number, number]
  size: [number, number, number]
}

type Side = 'N' | 'S' | 'E' | 'W'

export type RoomOpening = {
  kind: 'window' | 'door' | 'entry'
  side: Side
  /** where it sits relative to the camera: the wall being faced, behind, or a side wall */
  viewRel: 'facing' | 'behind' | 'side'
  widthM: number
  sillM: number
  headM: number
  exterior: boolean
}

export type RoomModel = {
  boxes: RoomBox[]
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number }
  /** interior clear dimensions, metres */
  dims: { w: number; d: number; h: number }
  openings: RoomOpening[]
  /** the wall the camera faces */
  focal: Side
  /** unit-ish vector from the room centre toward the main daylight source */
  daylightDir: [number, number, number]
  zone: string
  name: string
  roomId: string
  floorName: string
  floorLevel: number
}

const EXT_T = 0.23
const INT_T = 0.115
const SLAB = 0.12
const DOOR_HEAD = 2.1
const OPP: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function buildRoom(
  design: Design,
  floorLevel: number,
  roomId: string,
  character: Character,
): RoomModel | null {
  const floor = design.floors.find((f) => f.level === floorLevel) ?? design.floors[0]
  const room = floor.rooms.find((r) => r.id === roomId)
  if (!room || room.outdoor) return null

  const T = THEMES[character]
  const winBand = { sill: T.windows.sillMm / 1000, head: T.windows.headMm / 1000 }

  const rect = room.rect
  const cxMm = rect.x + rect.w / 2
  const cyMm = rect.y + rect.h / 2
  const rw = rect.w / 1000
  const rd = rect.h / 1000
  const rh = clamp(design.model.brief.levels.floorToFloor - SLAB, 2.4, 3.6)
  const halfW = rw / 2
  const halfD = rd / 2
  const outline = floor.outline

  const boxes: RoomBox[] = []
  const push = (id: string, mat: RoomMatKey, pos: [number, number, number], size: [number, number, number]) => {
    if (size[0] > 0.01 && size[1] > 0.01 && size[2] > 0.01) boxes.push({ id, mat, pos, size })
  }

  // ---- floor + ceiling slabs (slightly oversized so corners never gap) ----
  push('floor', 'slab', [0, -SLAB / 2, 0], [rw + 0.5, SLAB, rd + 0.5])
  push('ceil', 'ceil', [0, rh + SLAB / 2, 0], [rw + 0.5, SLAB, rd + 0.5])

  // ---- classify this room's openings onto its four edges ----
  const edgeLine: Record<Side, number> = {
    N: rect.y,
    S: rectBottom(rect),
    W: rect.x,
    E: rectRight(rect),
  }
  const isExt: Record<Side, boolean> = {
    N: edgeIsExterior(rect, 'N', outline),
    S: edgeIsExterior(rect, 'S', outline),
    W: edgeIsExterior(rect, 'W', outline),
    E: edgeIsExterior(rect, 'E', outline),
  }

  type Raw = { kind: RoomOpening['kind']; side: Side; along: number; widthM: number; sillM: number; headM: number }
  const raw: Raw[] = []
  for (const op of floor.openings) {
    for (const side of ['N', 'S', 'E', 'W'] as Side[]) {
      const horizontal = side === 'N' || side === 'S'
      if (op.orient !== (horizontal ? 'h' : 'v')) continue
      const perp = horizontal ? op.at.y : op.at.x
      const along = horizontal ? op.at.x : op.at.y
      if (Math.abs(perp - edgeLine[side]) > 260) continue
      const lo = horizontal ? rect.x : rect.y
      const hi = horizontal ? rectRight(rect) : rectBottom(rect)
      if (along < lo + 150 || along > hi - 150) continue

      const band = op.kind === 'window' ? winBand : { sill: 0, head: DOOR_HEAD }
      raw.push({
        kind: op.kind,
        side,
        along: (along - (horizontal ? cxMm : cyMm)) / 1000,
        widthM: Math.min(op.width, hi - lo - 600) / 1000,
        sillM: band.sill,
        headM: Math.min(band.head, rh - 0.15),
      })
      break
    }
  }

  // ---- camera: face the wall with the widest window, else a long wall ----
  const wins = raw.filter((o) => o.kind === 'window').sort((a, b) => b.widthM - a.widthM)
  const focal: Side = wins[0]?.side ?? (rw >= rd ? 'S' : 'E')
  const opp = OPP[focal]
  const focalHoriz = focal === 'N' || focal === 'S'
  const focalFixed = focal === 'N' ? -halfD : focal === 'S' ? halfD : focal === 'W' ? -halfW : halfW
  const oppFixed = -focalFixed
  const focalLen = focalHoriz ? rw : rd
  const sideLen = focalHoriz ? rd : rw

  const winAlong = wins[0]?.along ?? 0
  const pullIn = clamp(sideLen * 0.34, 0.35, 0.7)
  const camPerp = oppFixed - Math.sign(oppFixed || 1) * pullIn
  const latMax = Math.max(0.05, focalLen / 2 - 0.55)
  const camLat = clamp(-Math.sign(winAlong || 1) * focalLen * 0.3, -latMax, latMax)
  const tgtAlong = clamp(winAlong * 0.55, -focalLen / 2 + 0.6, focalLen / 2 - 0.6)
  const tgtPerp = focalFixed - Math.sign(focalFixed || 1) * 0.2

  const position: [number, number, number] = focalHoriz ? [camLat, 1.5, camPerp] : [camPerp, 1.5, camLat]
  const target: [number, number, number] = focalHoriz ? [tgtAlong, 1.12, tgtPerp] : [tgtPerp, 1.12, tgtAlong]
  const minDim = Math.min(rw, rd)
  const fov = clamp(58 + (4.2 - minDim) * 6.5, 56, 76)

  // ---- four walls, segmented around their openings ----
  for (const side of ['N', 'S', 'E', 'W'] as Side[]) {
    const t = isExt[side] ? EXT_T : INT_T
    const horizontal = side === 'N' || side === 'S'
    const len = horizontal ? rw : rd
    const fixed = side === 'N' ? -halfD : side === 'S' ? halfD : side === 'W' ? -halfW : halfW
    const outward = Math.sign(fixed || (side === 'N' ? -1 : 1))
    const ops = raw.filter((o) => o.side === side).sort((a, b) => a.along - b.along)

    // a rectangle on this wall plane: (along a..b) × (height y0..y1), at depth `at`
    const slab = (
      a: number,
      b: number,
      y0: number,
      y1: number,
      sub: string,
      mat: RoomMatKey,
      at: number,
      thick: number,
    ) => {
      const w = b - a
      const h = y1 - y0
      if (w < 0.02 || h < 0.02) return
      push(
        `w-${side}-${sub}`,
        mat,
        horizontal ? [(a + b) / 2, (y0 + y1) / 2, at] : [at, (y0 + y1) / 2, (a + b) / 2],
        horizontal ? [w, h, thick] : [thick, h, w],
      )
    }
    const wall = (a: number, b: number, y0: number, y1: number, sub: string) =>
      slab(a, b, y0, y1, sub, 'wall', fixed, t)

    const half = len / 2
    const innerFace = fixed - outward * (t / 2 - 0.006)
    const fr = 0.06
    let cursor = -half
    ops.forEach((o, i) => {
      const s = clamp(o.along - o.widthM / 2, -half + 0.04, half - 0.04)
      const e = clamp(o.along + o.widthM / 2, s + 0.2, half - 0.04)
      wall(cursor, s, 0, rh, `p${i}`)
      if (o.sillM > 0.05) wall(s, e, 0, o.sillM, `sill${i}`)
      if (rh - o.headM > 0.05) wall(s, e, o.headM, rh, `head${i}`)

      // the void — glass for a window, a dark recess for a doorway
      slab(
        s,
        e,
        o.sillM,
        o.headM,
        `void${i}`,
        o.kind === 'window' ? 'glass' : 'reveal',
        fixed + outward * 0.055,
        0.04,
      )

      // a slim reveal frame on the inner face — crisp lines for the edge map
      slab(s - fr, e + fr, o.headM, o.headM + fr, `fr${i}t`, 'trim', innerFace, 0.05)
      if (o.sillM > 0.05) slab(s - fr, e + fr, o.sillM - fr, o.sillM, `fr${i}b`, 'trim', innerFace, 0.05)
      slab(s - fr, s, o.sillM, o.headM, `fr${i}l`, 'trim', innerFace, 0.05)
      slab(e, e + fr, o.sillM, o.headM, `fr${i}r`, 'trim', innerFace, 0.05)

      cursor = e
    })
    wall(cursor, half, 0, rh, 'pE')
  }

  const relOf = (side: Side): RoomOpening['viewRel'] =>
    side === focal ? 'facing' : side === opp ? 'behind' : 'side'

  return {
    boxes,
    camera: { position, target, fov },
    dims: { w: rw, d: rd, h: rh },
    openings: raw.map((o) => ({
      kind: o.kind,
      side: o.side,
      viewRel: relOf(o.side),
      widthM: o.widthM,
      sillM: o.sillM,
      headM: o.headM,
      exterior: isExt[o.side],
    })),
    focal,
    daylightDir: focalHoriz ? [0, 0.25, Math.sign(focalFixed) || 1] : [Math.sign(focalFixed) || 1, 0.25, 0],
    zone: room.zone,
    name: room.name,
    roomId,
    floorName: floor.name,
    floorLevel: floor.level,
  }
}
