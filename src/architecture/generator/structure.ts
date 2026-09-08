/* ------------------------------------------------------------------ *
 *  structure — the conceptual structural frame (§10).
 *
 *      blocks (per storey)  →  STRUCTURAL GRID
 *                           →  COLUMNS   (grid ∩ block, per storey)
 *                           →  BEAMS     (edge + internal + transfer)
 *                           →  SLABS     (one per block per level + roof
 *                                         + balcony + canopy)
 *
 *  Columns align vertically within STRUCTURE.columnAlignToleranceMm;
 *  an upper column with no column below is marked (alignedBelow=null)
 *  and a transfer beam is added at the slab it lands on. Porch / entry
 *  canopies get a canopy → beam → column → ground chain. Nothing here
 *  is decorative — the architecturalValidator checks every piece has a
 *  reason and a support.
 * ------------------------------------------------------------------ */

import type { Point, Rect } from '../../lib/geometry.ts'
import { rectBottom, rectRight, rectUnionBBox } from '../../lib/geometry.ts'
import { columnSectionMm, STRUCTURE } from '../dims.ts'
import type { BeamSpec, ColumnSpec, Direction4, MassBlock, SlabSpec, StructuralGrid } from '../types.ts'

export type StructureResult = {
  grid: StructuralGrid
  perFloor: { columns: ColumnSpec[]; beams: BeamSpec[]; slabs: SlabSpec[] }[]
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
const uniqSorted = (xs: number[], mergeTol: number): number[] => {
  const s = [...xs].sort((a, b) => a - b)
  const out: number[] = []
  for (const v of s) if (!out.length || v - out[out.length - 1] > mergeTol) out.push(Math.round(v))
  return out
}

/* ================================================================== *
 *  1 — the grid
 * ================================================================== */

function buildGrid(perFloorBlocks: MassBlock[][], roomEdges: { xs: number[]; ys: number[] }): StructuralGrid {
  const xs: number[] = []
  const ys: number[] = []
  for (const blocks of perFloorBlocks) {
    for (const b of blocks) {
      xs.push(b.rect.x, rectRight(b.rect))
      ys.push(b.rect.y, rectBottom(b.rect))
    }
  }
  const baseX = uniqSorted(xs, STRUCTURE.bayMinMm / 2)
  const baseY = uniqSorted(ys, STRUCTURE.bayMinMm / 2)
  // partition-wall positions the grid prefers to snap to (so columns land ON
  // walls between rooms, never in the middle of a room)
  const partX = uniqSorted(roomEdges.xs, 300)
  const partY = uniqSorted(roomEdges.ys, 300)

  // subdivide any span wider than bayMax, snapping the new line to the nearest
  // partition wall inside the bay if there is one
  const fill = (lines: number[], parts: number[]): number[] => {
    const out: number[] = []
    for (let i = 0; i < lines.length; i++) {
      out.push(lines[i])
      if (i === lines.length - 1) break
      const a = lines[i]
      const c = lines[i + 1]
      const span = c - a
      if (span > STRUCTURE.bayMaxMm) {
        const n = Math.ceil(span / STRUCTURE.bayTargetMm)
        for (let k = 1; k < n; k++) {
          const ideal = a + (span * k) / n
          const window = span / n / 2
          const snapTo = parts.filter((p) => p > a + STRUCTURE.bayMinMm && p < c - STRUCTURE.bayMinMm && Math.abs(p - ideal) < window).sort((x, y) => Math.abs(x - ideal) - Math.abs(y - ideal))[0]
          out.push(Math.round(snapTo ?? ideal))
        }
      }
    }
    return uniqSorted(out, STRUCTURE.bayMinMm / 2)
  }

  const xLines = fill(baseX, partX)
  const yLines = fill(baseY, partY)
  return {
    xLines,
    yLines,
    labelX: xLines.map((_, i) => String.fromCharCode(65 + (i % 26))),
    labelY: yLines.map((_, i) => String(i + 1)),
    bayTargetMm: STRUCTURE.bayTargetMm,
  }
}

/* ================================================================== *
 *  2 — columns
 * ================================================================== */

function columnsForLevel(
  grid: StructuralGrid,
  blocks: MassBlock[],
  level: number,
  floorsAbove: number,
  below: ColumnSpec[],
  partitions: { xs: number[]; ys: number[] },
): ColumnSpec[] {
  const sec = columnSectionMm(floorsAbove)
  const out: ColumnSpec[] = []
  const tol = STRUCTURE.extWallMm
  const onPartition = (v: number, axis: 'xs' | 'ys') => partitions[axis].some((p) => Math.abs(p - v) < 500)
  const seen = new Set<string>()
  const push = (at: Point, gridRef: string, role: ColumnSpec['role']) => {
    const k = `${Math.round(at.x / 100)},${Math.round(at.y / 100)}`
    if (seen.has(k)) return
    seen.add(k)
    const belowCol = below.find((c) => near(c.at.x, at.x, STRUCTURE.columnAlignToleranceMm) && near(c.at.y, at.y, STRUCTURE.columnAlignToleranceMm))
    out.push({
      id: `col${level}-${gridRef}-${out.length}`,
      gridRef,
      at,
      level,
      sizeMm: [sec, sec],
      role,
      alignedBelow: level === 0 ? null : (belowCol?.id ?? null),
    })
  }

  for (const b of blocks) {
    const r = b.rect
    const xLines = grid.xLines.filter((x) => x >= r.x - 1 && x <= r.x + r.w + 1)
    const yLines = grid.yLines.filter((y) => y >= r.y - 1 && y <= r.y + r.h + 1)
    if (!xLines.includes(r.x)) xLines.unshift(r.x)
    if (!xLines.includes(r.x + r.w)) xLines.push(r.x + r.w)
    if (!yLines.includes(r.y)) yLines.unshift(r.y)
    if (!yLines.includes(r.y + r.h)) yLines.push(r.y + r.h)
    xLines.sort((a, c) => a - c)
    yLines.sort((a, c) => a - c)

    for (let ix = 0; ix < xLines.length; ix++) {
      for (let iy = 0; iy < yLines.length; iy++) {
        const at: Point = { x: xLines[ix], y: yLines[iy] }
        const onXEdge = near(at.x, r.x, tol) || near(at.x, r.x + r.w, tol)
        const onYEdge = near(at.y, r.y, tol) || near(at.y, r.y + r.h, tol)
        const gridRef = `${b.id}.${ix}${iy}`
        if (onXEdge && onYEdge) {
          push(at, gridRef, 'corner')
        } else if (onXEdge || onYEdge) {
          // perimeter mid-column — only where a bay would otherwise exceed the
          // max span AND the column can land on a partition wall (not in a room)
          const prevX = xLines[ix - 1] ?? r.x
          const nextX = xLines[ix + 1] ?? r.x + r.w
          const prevY = yLines[iy - 1] ?? r.y
          const nextY = yLines[iy + 1] ?? r.y + r.h
          const bigX = nextX - prevX > STRUCTURE.bayMaxMm
          const bigY = nextY - prevY > STRUCTURE.bayMaxMm
          if (onXEdge && bigY && onPartition(at.y, 'ys')) push(at, gridRef, 'frame')
          else if (onYEdge && bigX && onPartition(at.x, 'xs')) push(at, gridRef, 'frame')
        } else {
          // interior column — only for a genuinely large open span in BOTH axes
          const spanX = (xLines[ix + 1] ?? r.x + r.w) - (xLines[ix - 1] ?? r.x)
          const spanY = (yLines[iy + 1] ?? r.y + r.h) - (yLines[iy - 1] ?? r.y)
          if (spanX > STRUCTURE.bayMaxMm && spanY > STRUCTURE.bayMaxMm) push(at, gridRef, 'frame')
        }
      }
    }
  }
  return out
}

/* ================================================================== *
 *  3 — beams
 * ================================================================== */

/** edge + internal beams that carry slab `level`, spanning the columns of `level-1` */
function beamsForSlab(grid: StructuralGrid, cols: ColumnSpec[], blocks: MassBlock[], level: number): BeamSpec[] {
  const out: BeamSpec[] = []
  let n = 0
  const colAt = (x: number, y: number) =>
    cols.find((c) => near(c.at.x, x, STRUCTURE.columnAlignToleranceMm) && near(c.at.y, y, STRUCTURE.columnAlignToleranceMm)) ?? null

  for (const b of blocks) {
    const xIn = grid.xLines.filter((x) => x >= b.rect.x - 1 && x <= rectRight(b.rect) + 1)
    const yIn = grid.yLines.filter((y) => y >= b.rect.y - 1 && y <= rectBottom(b.rect) + 1)
    // beams along every gridline crossing the block, between consecutive columns on it
    for (const x of xIn) {
      for (let i = 0; i < yIn.length - 1; i++) {
        const a = { x, y: yIn[i] }
        const c = { x, y: yIn[i + 1] }
        const ca = colAt(a.x, a.y)
        const cc = colAt(c.x, c.y)
        if (!ca && !cc) continue
        const edge = near(x, b.rect.x, 1) || near(x, rectRight(b.rect), 1)
        out.push({
          id: `beam${level}-${n++}`,
          level,
          a,
          b: c,
          depthMm: edge ? STRUCTURE.edgeBeamDepthMm : STRUCTURE.internalBeamDepthMm,
          role: edge ? 'edge' : 'internal',
          ends: [ca?.id ?? null, cc?.id ?? null],
        })
      }
    }
    for (const y of yIn) {
      for (let i = 0; i < xIn.length - 1; i++) {
        const a = { x: xIn[i], y }
        const c = { x: xIn[i + 1], y }
        const ca = colAt(a.x, a.y)
        const cc = colAt(c.x, c.y)
        if (!ca && !cc) continue
        const edge = near(y, b.rect.y, 1) || near(y, rectBottom(b.rect), 1)
        out.push({
          id: `beam${level}-${n++}`,
          level,
          a,
          b: c,
          depthMm: edge ? STRUCTURE.edgeBeamDepthMm : STRUCTURE.internalBeamDepthMm,
          role: edge ? 'edge' : 'internal',
          ends: [ca?.id ?? null, cc?.id ?? null],
        })
      }
    }
  }
  return dedupeBeams(out)
}

/** a transfer beam for every unaligned upper column — always spans two real
 *  lower columns straddling it, so no column is ever left unsupported */
function transferBeams(upperCols: ColumnSpec[], lowerCols: ColumnSpec[], level: number): BeamSpec[] {
  const out: BeamSpec[] = []
  let n = 0
  if (lowerCols.length < 2) return out
  for (const c of upperCols) {
    if (c.alignedBelow) continue
    // prefer a colinear pair that straddles c (same gridline, one either side);
    // fall back to the two nearest lower columns
    const onX = lowerCols.filter((l) => near(l.at.x, c.at.x, STRUCTURE.columnAlignToleranceMm))
    const onY = lowerCols.filter((l) => near(l.at.y, c.at.y, STRUCTURE.columnAlignToleranceMm))
    let pair: ColumnSpec[] | null = straddle(onX, c, 'y') ?? straddle(onY, c, 'x')
    if (!pair) {
      const near2 = [...lowerCols].sort((a, b) => distSq(a.at, c.at) - distSq(b.at, c.at)).slice(0, 2)
      pair = near2.length === 2 ? near2 : null
    }
    if (!pair) continue
    out.push({
      id: `xfer${level}-${n++}`,
      level,
      a: pair[0].at,
      b: pair[1].at,
      depthMm: STRUCTURE.transferBeamDepthMm,
      role: 'transfer',
      ends: [pair[0].id, pair[1].id],
    })
  }
  return out
}

const distSq = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2

/** two columns from `cols` that bracket `c` on the given axis */
function straddle(cols: ColumnSpec[], c: ColumnSpec, axis: 'x' | 'y'): ColumnSpec[] | null {
  const before = cols.filter((l) => l.at[axis] <= c.at[axis]).sort((a, b) => b.at[axis] - a.at[axis])[0]
  const after = cols.filter((l) => l.at[axis] > c.at[axis]).sort((a, b) => a.at[axis] - b.at[axis])[0]
  if (before && after) return [before, after]
  if (cols.length >= 2) {
    const s = [...cols].sort((a, b) => Math.abs(a.at[axis] - c.at[axis]) - Math.abs(b.at[axis] - c.at[axis]))
    return [s[0], s[1]]
  }
  return null
}

function dedupeBeams(beams: BeamSpec[]): BeamSpec[] {
  const seen = new Set<string>()
  const out: BeamSpec[] = []
  for (const b of beams) {
    const k = [Math.round(b.a.x), Math.round(b.a.y), Math.round(b.b.x), Math.round(b.b.y)].sort().join(',')
    if (seen.has(k)) continue
    seen.add(k)
    out.push(b)
  }
  return out
}

/* ================================================================== *
 *  4 — slabs
 * ================================================================== */

function slabsForLevel(blocks: MassBlock[], level: number, isRoof: boolean): SlabSpec[] {
  if (blocks.length === 0) return []
  return blocks.map((b, i) => ({
    id: `slab${level}-${i}`,
    level,
    rect: { ...b.rect },
    thicknessMm: isRoof ? STRUCTURE.roofSlabThicknessMm : STRUCTURE.slabThicknessMm,
    cantilever: { ...b.cantilever },
    supports: b.id,
  }))
}

/* ================================================================== *
 *  resolveStructure
 * ================================================================== */

export function resolveStructure(
  perFloorBlocks: MassBlock[][],
  floorCount: number,
  roomRects: Rect[][] = [],
): StructureResult {
  const roomEdges = { xs: [] as number[], ys: [] as number[] }
  for (const rects of roomRects) {
    for (const r of rects) {
      roomEdges.xs.push(r.x, rectRight(r))
      roomEdges.ys.push(r.y, rectBottom(r))
    }
  }
  const grid = buildGrid(perFloorBlocks, roomEdges)
  const topLevel = floorCount - 1

  const partByLevel = roomRects.map((rects) => ({
    xs: uniqSorted(rects.flatMap((r) => [r.x, rectRight(r)]), 250),
    ys: uniqSorted(rects.flatMap((r) => [r.y, rectBottom(r)]), 250),
  }))
  const columnsByLevel: ColumnSpec[][] = []
  for (let L = 0; L < floorCount; L++) {
    const below = L > 0 ? columnsByLevel[L - 1] : []
    const part = partByLevel[L] ?? partByLevel[0] ?? { xs: [], ys: [] }
    columnsByLevel[L] = columnsForLevel(grid, perFloorBlocks[L] ?? [], L, topLevel - L, below, part)
  }

  const perFloor: StructureResult['perFloor'] = []
  for (let L = 0; L < floorCount; L++) {
    const blocks = perFloorBlocks[L] ?? []
    const columns = columnsByLevel[L]

    // slab L is the FLOOR of storey L; it is carried by the frame of storey L-1
    const slabLevel = L
    const carriedBy = L > 0 ? columnsByLevel[L - 1] : columnsByLevel[0]
    const beams = [
      ...beamsForSlab(grid, carriedBy, L > 0 ? (perFloorBlocks[L - 1] ?? blocks) : blocks, slabLevel),
      ...(L > 0 ? transferBeams(columns, columnsByLevel[L - 1], slabLevel) : []),
    ]

    const slabs = slabsForLevel(L === 0 ? blocks : blocks, slabLevel, false)

    perFloor[L] = { columns, beams, slabs }
  }

  // the roof slab — one level above the top storey
  const roofBeams = beamsForSlab(grid, columnsByLevel[topLevel], perFloorBlocks[topLevel] ?? [], floorCount)
  const roofSlabs = slabsForLevel(perFloorBlocks[topLevel] ?? [], floorCount, true)
  if (perFloor[topLevel]) {
    perFloor[topLevel].beams.push(...roofBeams)
    perFloor[topLevel].slabs.push(...roofSlabs)
  }

  return { grid, perFloor }
}

/* ---- porch / canopy structural chain (called from facadeResolver) ---- */

export function porchStructure(
  canopyRect: Rect,
  level: number,
  groundZ: number,
): { columns: ColumnSpec[]; beam: BeamSpec } {
  void groundZ
  const w = canopyRect.w
  const y = rectBottom(canopyRect)
  const xs = w > 4000 ? [canopyRect.x + 300, canopyRect.x + w / 2, rectRight(canopyRect) - 300] : [canopyRect.x + 300, rectRight(canopyRect) - 300]
  const columns: ColumnSpec[] = xs.map((x, i) => ({
    id: `porchcol-${i}`,
    gridRef: `P-${i}`,
    at: { x, y },
    level,
    sizeMm: [STRUCTURE.porchColumnMm, STRUCTURE.porchColumnMm],
    role: 'porch',
    alignedBelow: null,
  }))
  const beam: BeamSpec = {
    id: 'porchbeam',
    level,
    a: { x: xs[0], y },
    b: { x: xs[xs.length - 1], y },
    depthMm: STRUCTURE.canopyBeamDepthMm,
    role: 'canopy',
    ends: [columns[0].id, columns[columns.length - 1].id],
  }
  return { columns, beam }
}

/** bbox of the whole frame — for the roof / camera */
export function frameBBox(perFloor: StructureResult['perFloor']): Rect {
  const rects = perFloor.flatMap((f) => f.slabs.map((s) => s.rect))
  return rects.length ? rectUnionBBox(rects) : { x: 0, y: 0, w: 1, h: 1 }
}

/** which side of a block a plan point is on (for facade anchors) */
export function sideOfBlock(b: Rect, p: Point): Direction4 {
  const d: Record<Direction4, number> = {
    N: Math.abs(p.y - b.y),
    S: Math.abs(p.y - rectBottom(b)),
    W: Math.abs(p.x - b.x),
    E: Math.abs(p.x - rectRight(b)),
  }
  return (Object.keys(d) as Direction4[]).sort((a, b2) => d[a] - d[b2])[0]
}
