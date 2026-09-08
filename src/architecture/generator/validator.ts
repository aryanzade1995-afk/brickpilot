/* ------------------------------------------------------------------ *
 *  validator — check a DesignSpec against the GenerationConstraints
 *  BEFORE it goes to Blender. Cheap repairs are applied in place
 *  (drop an over-budget window, pull a block inside the setbacks,
 *  clamp a cantilever); anything left is reported as an issue.
 *
 *  The Blender side runs the equivalent checks in
 *  blender/generator/validator.py against the built geometry.
 * ------------------------------------------------------------------ */

import type { Rect } from '../../lib/geometry.ts'
import { rectArea, rectBottom, rectRight } from '../../lib/geometry.ts'
import type { DesignSpec, GenerationConstraints } from '../types.ts'

export function validateSpec(spec: DesignSpec, c: GenerationConstraints): DesignSpec['validation'] {
  const issues: string[] = []
  const repaired: string[] = []

  const plot: Rect = { x: 0, y: 0, w: spec.plot.widthMm, h: spec.plot.depthMm }
  const buildable: Rect = {
    x: spec.setbacksMm.W,
    y: spec.setbacksMm.N,
    w: spec.plot.widthMm - spec.setbacksMm.W - spec.setbacksMm.E,
    h: spec.plot.depthMm - spec.setbacksMm.N - spec.setbacksMm.S,
  }

  // ---- floors / heights
  if (spec.floors.length > c.maxFloors) issues.push(`too many storeys (${spec.floors.length} > ${c.maxFloors})`)
  for (const fl of spec.floors) {
    if (fl.heightMm < c.floorHeightMm[0] - 1 || fl.heightMm > c.floorHeightMm[1] + 1) {
      issues.push(`${fl.name}: floor height ${fl.heightMm} outside [${c.floorHeightMm.join(', ')}]`)
    }
  }

  // ---- blocks inside the buildable envelope (a recorded cantilever may overhang)
  let groundArea = 0
  for (const fl of spec.floors) {
    for (const b of fl.blocks) {
      const overhang = Math.max(0, b.cantilever.N ?? 0, b.cantilever.S ?? 0, b.cantilever.E ?? 0, b.cantilever.W ?? 0)
      const slack = overhang + 60
      const before = { ...b.rect }
      b.rect = clampInside(b.rect, buildable, slack)
      if (!rectEq(before, b.rect)) repaired.push(`${b.id}: pulled inside setbacks`)
      if (overhang > c.massing.maxCantileverMm) {
        const k = c.massing.maxCantileverMm
        for (const s of ['N', 'S', 'E', 'W'] as const) if ((b.cantilever[s] ?? 0) > k) b.cantilever[s] = k
        repaired.push(`${b.id}: cantilever clamped to ${c.massing.maxCantileverMm}`)
      }
      if (rectRight(b.rect) > rectRight(plot) + 1 || rectBottom(b.rect) > rectBottom(plot) + 1 || b.rect.x < -1 || b.rect.y < -1) {
        issues.push(`${b.id}: block leaves the plot`)
      }
      if (b.level === 0) groundArea += rectArea(b.rect)
    }
  }

  // ---- coverage
  const coverage = groundArea / rectArea(plot)
  if (coverage > c.maxCoverage + 0.02) issues.push(`coverage ${(coverage * 100).toFixed(0)}% > ${(c.maxCoverage * 100).toFixed(0)}%`)

  // ---- windows: ratio / spacing / count / valid host wall
  for (const fl of spec.floors) {
    const byRoomWall = new Map<string, { area: number; wallArea: number; centres: number[] }>()
    const keep: typeof fl.windows = []
    for (const w of fl.windows) {
      const wallLen = Math.hypot(w.wall.b.x - w.wall.a.x, w.wall.b.y - w.wall.a.y)
      if (wallLen < 400) {
        repaired.push(`${w.id}: dropped (host wall too short)`)
        continue
      }
      if (w.centerMm - w.widthMm / 2 < c.window.minCornerOffsetMm - 60 || w.centerMm + w.widthMm / 2 > wallLen - c.window.minCornerOffsetMm + 60) {
        repaired.push(`${w.id}: dropped (into a corner)`)
        continue
      }
      const key = `${w.roomId}|${w.side}`
      const acc = byRoomWall.get(key) ?? { area: 0, wallArea: wallLen * fl.heightMm, centres: [] }
      // spacing
      if (acc.centres.some((c2) => Math.abs(c2 - w.centerMm) < w.widthMm / 2 + c.window.minWallBetweenWindowsMm)) {
        repaired.push(`${w.id}: dropped (too close to a sibling)`)
        continue
      }
      // ratio
      if ((acc.area + w.widthMm * w.heightMm) / acc.wallArea > c.window.maxWindowRatio + 0.04 && acc.centres.length > 0) {
        repaired.push(`${w.id}: dropped (window-to-wall ratio)`)
        continue
      }
      acc.area += w.widthMm * w.heightMm
      acc.centres.push(w.centerMm)
      byRoomWall.set(key, acc)
      keep.push(w)
    }
    // per-room hard cap
    const perRoom = new Map<string, number>()
    fl.windows = keep.filter((w) => {
      const n = (perRoom.get(w.roomId) ?? 0) + 1
      perRoom.set(w.roomId, n)
      if (n > c.window.maxWindowsPerRoom) {
        repaired.push(`${w.id}: dropped (> ${c.window.maxWindowsPerRoom} per room)`)
        return false
      }
      return true
    })
  }

  // ---- balconies inside the plot
  for (const fl of spec.floors) {
    fl.balconies = fl.balconies.filter((b) => {
      const ok = b.rect.x > -60 && b.rect.y > -60 && rectRight(b.rect) < rectRight(plot) + 60 && rectBottom(b.rect) < rectBottom(plot) + 60
      if (!ok) repaired.push(`${b.id}: dropped (leaves the plot)`)
      return ok
    })
  }

  // ---- roof pitch sane
  for (const fl of spec.floors) {
    for (const b of fl.blocks) {
      if (b.roof.pitchDeg < 0 || b.roof.pitchDeg > 45) issues.push(`${b.id}: roof pitch ${b.roof.pitchDeg}° out of range`)
    }
  }

  return { ok: issues.length === 0, issues, repaired }
}

function clampInside(r: Rect, b: Rect, slack: number): Rect {
  const x = Math.max(b.x - slack, Math.min(r.x, rectRight(b) + slack - r.w))
  const y = Math.max(b.y - slack, Math.min(r.y, rectBottom(b) + slack - r.h))
  const w = Math.min(r.w, b.w + 2 * slack)
  const h = Math.min(r.h, b.h + 2 * slack)
  return { x, y, w, h }
}

function rectEq(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1
}
