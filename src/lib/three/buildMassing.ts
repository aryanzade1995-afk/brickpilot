import { rectBottom, rectRight } from '../geometry.ts'
import type { Design } from '../engine/types.ts'

export type MassBox = {
  id: string
  kind: 'wall' | 'floor-slab' | 'roof' | 'parapet' | 'canopy' | 'stair'
  /** world-space centre, metres */
  pos: [number, number, number]
  /** full extents, metres */
  size: [number, number, number]
  level: number
}

export type Massing = {
  boxes: MassBox[]
  floors: { level: number; baseY: number }[]
  bounds: { w: number; d: number }
  /** centre of the enclosed massing in world metres, for framing the camera */
  center: [number, number, number]
  floorHeight: number
  stats: {
    storeys: number
    heightM: number
    builtAreaSqm: number
    openings: number
  }
}

const SLAB = 0.15
const ROOF = 0.2
const PARAPET = 0.9

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/**
 * Turn a generated Design into a flat list of boxes in metres, centred on the
 * origin. Plan X → world X (east), plan Y → world Z (south), Y is up.
 */
export function buildMassing(design: Design): Massing {
  const { model } = design
  const cx = model.plot.width / 2
  const cy = model.plot.depth / 2
  const H = model.brief.levels.floorToFloor
  const wallH = H - SLAB

  const wx = (mm: number) => (mm - cx) / 1000
  const wz = (mm: number) => (mm - cy) / 1000
  const m = (mm: number) => mm / 1000

  const boxes: MassBox[] = []
  const topLevel = design.floors.length - 1

  for (const floor of design.floors) {
    const baseY = floor.level * H
    const o = floor.outline

    // floor slab (enclosed footprint)
    boxes.push({
      id: `slab-${floor.level}`,
      kind: 'floor-slab',
      pos: [wx(o.x + o.w / 2), baseY - SLAB / 2, wz(o.y + o.h / 2)],
      size: [m(o.w), SLAB, m(o.h)],
      level: floor.level,
    })

    // walls
    floor.walls.forEach((w, i) => {
      const horizontal = Math.abs(w.a.y - w.b.y) < Math.abs(w.a.x - w.b.x)
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
      const t = w.thickness
      const midX = (w.a.x + w.b.x) / 2
      const midY = (w.a.y + w.b.y) / 2
      boxes.push({
        id: `wall-${floor.level}-${i}`,
        kind: 'wall',
        pos: [wx(midX), baseY + wallH / 2, wz(midY)],
        size: horizontal ? [m(len), wallH, m(t)] : [m(t), wallH, m(len)],
        level: floor.level,
      })
    })

    // covered outdoor: slab + flat canopy, no walls
    for (const r of floor.rooms) {
      if (!r.outdoor) continue
      boxes.push({
        id: `oslab-${floor.level}-${r.id}`,
        kind: 'floor-slab',
        pos: [wx(r.rect.x + r.rect.w / 2), baseY - SLAB / 2, wz(r.rect.y + r.rect.h / 2)],
        size: [m(r.rect.w), SLAB, m(r.rect.h)],
        level: floor.level,
      })
      boxes.push({
        id: `canopy-${floor.level}-${r.id}`,
        kind: 'canopy',
        pos: [wx(r.rect.x + r.rect.w / 2), baseY + wallH, wz(r.rect.y + r.rect.h / 2)],
        size: [m(r.rect.w), 0.12, m(r.rect.h)],
        level: floor.level,
      })
    }

    // stair mass
    if (floor.stair) {
      const s = floor.stair.rect
      boxes.push({
        id: `stair-${floor.level}`,
        kind: 'stair',
        pos: [wx(s.x + s.w / 2), baseY + wallH / 2, wz(s.y + s.h / 2)],
        size: [m(s.w), wallH * 0.9, m(s.h)],
        level: floor.level,
      })
    }

    // roof + parapet on the top floor only
    if (floor.level === topLevel) {
      const roofY = baseY + wallH
      boxes.push({
        id: `roof-${floor.level}`,
        kind: 'roof',
        pos: [wx(o.x + o.w / 2), roofY + ROOF / 2, wz(o.y + o.h / 2)],
        size: [m(o.w) + 0.2, ROOF, m(o.h) + 0.2],
        level: floor.level,
      })
      const py = roofY + ROOF + PARAPET / 2
      const rim: { mx: number; my: number; size: [number, number, number] }[] = [
        { mx: o.x + o.w / 2, my: o.y, size: [m(o.w), PARAPET, 0.15] },
        { mx: o.x + o.w / 2, my: rectBottom(o), size: [m(o.w), PARAPET, 0.15] },
        { mx: o.x, my: o.y + o.h / 2, size: [0.15, PARAPET, m(o.h)] },
        { mx: rectRight(o), my: o.y + o.h / 2, size: [0.15, PARAPET, m(o.h)] },
      ]
      rim.forEach((seg, i) => {
        boxes.push({
          id: `parapet-${floor.level}-${i}`,
          kind: 'parapet',
          pos: [wx(seg.mx), py, wz(seg.my)],
          size: seg.size,
          level: floor.level,
        })
      })
    }
  }

  const enclosed = boxes.filter((b) => b.kind === 'wall' || b.kind === 'roof')
  const cxw = avg(enclosed.map((b) => b.pos[0]))
  const czw = avg(enclosed.map((b) => b.pos[2]))

  return {
    boxes,
    floors: design.floors.map((f) => ({ level: f.level, baseY: f.level * H })),
    bounds: { w: model.plot.width / 1000, d: model.plot.depth / 1000 },
    center: [cxw, (design.floors.length * wallH) / 2, czw],
    floorHeight: H,
    stats: {
      storeys: design.floors.length,
      heightM: design.heightM,
      builtAreaSqm: design.builtAreaSqm,
      openings: design.openingCounts.doors + design.openingCounts.windows,
    },
  }
}
