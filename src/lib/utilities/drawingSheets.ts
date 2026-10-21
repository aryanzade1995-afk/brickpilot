import type { Point, Rect } from '../geometry.ts'
import { UTILITY_LAYERS, UTILITY_SYMBOLS, connectedLoads, type UtilityFloor, type UtilityRun } from './plan.ts'
import { clashColor, type Clash } from './clashes.ts'
import { DRAWING_LAYERS, DRAWING_NAMES, drawingNumber, paperSize, dimensionText, lengthMm, type DrawingDocument, type DrawingLayer, type DrawingAnnotation } from './drawingProject.ts'

type Style = { color: string; width?: number; fill?: string; dash?: number[]; opacity?: number }
export type DrawOp = ({ kind: 'line'; a: Point; b: Point } | { kind: 'poly'; points: Point[]; closed?: boolean } | { kind: 'rect'; rect: Rect } | { kind: 'circle'; at: Point; r: number } | { kind: 'text'; at: Point; text: string; size: number; align?: 'left' | 'center' | 'right'; bold?: boolean } | { kind: 'clip'; rect: Rect; id: string } | { kind: 'endClip' } | { kind: 'group'; name: string } | { kind: 'endGroup' }) & Partial<Style>
export type DrawingSheet = { id: string; title: string; number: string; w: number; h: number; ops: DrawOp[]; tile?: { viewport: Rect; origin: Point; scale: number; col: number; row: number; cols: number; rows: number }; kind: 'plan' | 'schedule' | 'clashes'; layer: DrawingLayer }
const ink = '#323832', grey = '#b5bbb6'
export const escapeXml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const wrap = (s: string, width: number, font: number) => {
  const max = Math.max(4, Math.floor(width / (font * .56))), lines: string[] = []
  for (const paragraph of s.split('\n')) { let line = ''; for (const word of paragraph.split(/\s+/)) { if ((line + ' ' + word).length > max && line) { lines.push(line); line = '' } for (const c of (line ? ' ' : '') + word) { if (line.length >= max) { lines.push(line); line = '' } line += c } } lines.push(line) }
  return lines
}
export function symbolOps(type: string, at: Point, color: string, r = 1.4): DrawOp[] {
  const ops: DrawOp[] = [], line = (x: number, y: number, u: number, v: number) => ops.push({ kind: 'line', a: { x: at.x + x * r, y: at.y + y * r }, b: { x: at.x + u * r, y: at.y + v * r }, color, width: .2 })
  const circle = (radius = 1, fill = 'white') => ops.push({ kind: 'circle', at, r: r * radius, color, fill, width: .22 })
  const label = (text: string, fill = color) => ops.push({ kind: 'text', at: { x: at.x, y: at.y + r * .35 }, size: r * 1.2, align: 'center', text, color: fill })
  if (['db_panel', 'fire_panel', 'manual_call_point', 'supply_inlet', 'hot_supply_inlet', 'exit_sign'].includes(type)) {
    const filled = type !== 'manual_call_point'
    ops.push({ kind: 'rect', rect: { x: at.x - r * 1.3, y: at.y - r, w: r * 2.6, h: r * 2 }, color, fill: filled ? color : 'white', width: .22 })
    label(({ db_panel: 'DB', fire_panel: 'FP', manual_call_point: 'M', supply_inlet: 'CW', hot_supply_inlet: 'HW', exit_sign: 'EXIT >' } as Record<string, string>)[type], filled ? 'white' : color)
  } else if (type === 'extinguisher') ops.push({ kind: 'poly', points: [{ x: at.x, y: at.y - r }, { x: at.x + r, y: at.y + r }, { x: at.x - r, y: at.y + r }], closed: true, fill: color, color, width: .2 })
  else if (type === 'isolation_valve') ops.push({ kind: 'poly', points: [{ x: at.x - r, y: at.y - r }, { x: at.x + r, y: at.y + r }, { x: at.x + r, y: at.y - r }, { x: at.x - r, y: at.y + r }], closed: true, color, width: .2 })
  else {
    circle(1, type === 'floor_drain' ? color : 'white')
    if (type === 'vertical_stack') circle(.5, color)
    else if (type === 'smoke_detector' || type === 'heat_detector') label(type === 'smoke_detector' ? 'S' : 'H')
    else if (type === 'socket') { line(-.3, -.5, -.3, .4); line(.3, -.5, .3, .4) }
    else if (type === 'light' || type === 'exhaust_fan') { line(-.6, -.6, .6, .6); line(.6, -.6, -.6, .6) }
    else if (type === 'sprinkler') { line(-.7, 0, .7, 0); line(0, -.7, 0, .7) }
    else if (type === 'switch') { line(.7, -.7, 1.5, -1.5); label('S') }
    else if (type === 'water_outlet') { line(0, .6, 0, -.6); line(0, -.6, 1, -.6) }
    else if (type === 'sounder') { line(1.3, -.6, 1.7, 0); line(1.7, 0, 1.3, .6) }
  }
  return ops
}
function arrow(ops: DrawOp[], a: Point, b: Point, color = ink, size = 1.3) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  ops.push({ kind: 'poly', points: [{ x: b.x - size * Math.cos(angle - .45), y: b.y - size * Math.sin(angle - .45) }, b, { x: b.x - size * Math.cos(angle + .45), y: b.y - size * Math.sin(angle + .45) }], color, width: .2 })
}
export function cloudPoints(a: Point, b: Point, radius: number) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y), points: Point[] = []
  const corners = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }]
  for (let i = 1; i < corners.length; i++) {
    const p = corners[i - 1], q = corners[i], length = Math.hypot(q.x - p.x, q.y - p.y), n = Math.max(1, Math.ceil(length / Math.max(radius * 2, 1))), dx = (q.x - p.x) / (length || 1), dy = (q.y - p.y) / (length || 1)
    for (let j = 0; j < n; j++) for (let k = 0; k <= 8; k++) { const t = (j + k / 8) / n, bulge = Math.sin(k / 8 * Math.PI) * Math.min(radius, length / n / 2); points.push({ x: p.x + dx * length * t + dy * bulge, y: p.y + dy * length * t - dx * bulge }) }
  }
  return points
}
export function annotationOps(a: DrawingAnnotation, transform: (p: Point) => Point, scale = 100): DrawOp[] {
  const p = transform(a.a), q = transform(a.b), ops: DrawOp[] = [], color = a.type === 'cloud' ? '#a94b45' : '#3f655a'
  const text = (point: Point, value: string) => ops.push({ kind: 'text', at: point, text: value, size: 2.5, color })
  if (a.type === 'dimension') {
    const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len * 4, ny = dx / len * 4
    const start = { x: p.x + nx, y: p.y + ny }, end = { x: q.x + nx, y: q.y + ny }
    ops.push({ kind: 'line', a: p, b: { x: start.x + nx * .3, y: start.y + ny * .3 }, color, width: .15 }, { kind: 'line', a: q, b: { x: end.x + nx * .3, y: end.y + ny * .3 }, color, width: .15 }, { kind: 'line', a: start, b: end, color, width: .18 })
    arrow(ops, end, start, color); arrow(ops, start, end, color)
    ops.push({ kind: 'text', at: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 1.2 }, align: 'center', text: dimensionText(a.a, a.b, a.units), size: 2.5, color })
  } else if (a.type === 'cloud') { ops.push({ kind: 'poly', points: cloudPoints(p, q, 1.7), closed: true, color, width: .3 }); text({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y) - 2 }, a.text) }
  else { if (a.type === 'leader') { ops.push({ kind: 'line', a: p, b: q, color, width: .2 }); arrow(ops, q, p, color) } for (const [i, line] of wrap(a.text, 60, 2.5).entries()) text({ x: q.x, y: q.y + i * 3.4 }, line) }
  void scale
  return ops
}

type Table = { title: string; rows: string[] }
export function schedules(model: UtilityFloor, layers: readonly string[]): Table[] {
  const result: Table[] = []
  for (const layer of layers) {
    const runs = model.utilities.filter(r => r.layer === layer)
    if (layer === 'drainage') result.push({ title: 'DRAINAGE SCHEDULE - concept route lengths', rows: runs.map(r => { if (r.layer !== 'drainage') return ''; const f = model.fixtures.find(f => f.id === r.fixtureId); return `${model.floor.rooms.find(x => x.id === r.roomId)?.name ?? r.roomId} / ${f?.type ?? 'fixture'} | ${r.diameter} mm ${r.material} | ${(lengthMm(r.path) / 1000).toFixed(2)} m` }) })
    if (layer === 'electrical') result.push({ title: 'ELECTRICAL SCHEDULE - proposed loads', rows: model.circuits.map(c => `${c.tag} ${c.name} | ${c.breaker} | ${c.wireSize.replace('mm2', ' mm²')} | ${connectedLoads(model, c).length}/${c.loads.length} connected devices; watts unknown`) })
    if (layer === 'fire_alarm') result.push({ title: 'FIRE ALARM SCHEDULE - concept loop', rows: model.zones.map(z => `${z.tag} ${z.name} | ${z.devices.length} loop devices | ${z.cableType} | ${z.loopStatus}; standalone equipment excluded`) })
    if (layer === 'water_supply') result.push({ title: 'WATER SUPPLY SCHEDULE - proposed lines', rows: runs.map(r => r.layer === 'water_supply' ? `${r.id} | ${r.service} | ${r.diameter} mm ${r.material} | ${(lengthMm(r.path) / 1000).toFixed(2)} m` : '') })
  }
  return result
}
export function pipeTag(r: UtilityRun) {
  if (r.layer === 'drainage') return `${r.diameter}mm ${r.material} @ slope unverified`
  if (r.layer === 'water_supply') return `${r.diameter}mm ${r.material} (${r.service})`
  return r.layer === 'electrical' ? r.wireSize.replace('mm2', 'mm²') : r.cableType
}
function planOps(model: UtilityFloor, doc: DrawingDocument, layers: readonly string[], tile: NonNullable<DrawingSheet['tile']>, clashes: Clash[]): DrawOp[] {
  const ops: DrawOp[] = [], s = tile.scale, tr = (p: Point): Point => ({ x: tile.viewport.x + (p.x - tile.origin.x) / s, y: tile.viewport.y + (p.y - tile.origin.y) / s })
  const box = (r: Rect): Rect => ({ ...tr(r), w: r.w / s, h: r.h / s })
  ops.push({ kind: 'clip', rect: tile.viewport, id: 'plan-clip' }, { kind: 'group', name: 'walls' })
  if (doc.grid) for (let x = tile.origin.x; x <= tile.origin.x + tile.viewport.w * s; x += 1000) ops.push({ kind: 'line', a: tr({ x, y: tile.origin.y }), b: tr({ x, y: tile.origin.y + tile.viewport.h * s }), color: '#e6e9e6', width: .1 })
  if (doc.grid) for (let y = tile.origin.y; y <= tile.origin.y + tile.viewport.h * s; y += 1000) ops.push({ kind: 'line', a: tr({ x: tile.origin.x, y }), b: tr({ x: tile.origin.x + tile.viewport.w * s, y }), color: '#e6e9e6', width: .1 })
  for (const slab of model.slabs) ops.push({ kind: 'rect', rect: box(slab), color: '#dadfda', width: .18 })
  for (const wall of model.floor.walls) ops.push({ kind: 'line', a: tr(wall.a), b: tr(wall.b), color: grey, width: Math.max(.3, wall.thickness / s) })
  for (const o of model.floor.openings) { const offset = o.width / 2; ops.push({ kind: 'line', a: tr({ x: o.at.x - (o.orient === 'h' ? offset : 0), y: o.at.y - (o.orient === 'v' ? offset : 0) }), b: tr({ x: o.at.x + (o.orient === 'h' ? offset : 0), y: o.at.y + (o.orient === 'v' ? offset : 0) }), color: o.kind === 'window' ? '#dce5e4' : '#ffffff', width: Math.max(2.6, ...model.floor.walls.map(w => w.thickness / s + .2)) }) }
  for (const room of model.floor.rooms) ops.push({ kind: 'text', at: tr({ x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2 }), align: 'center', text: room.name, size: 2.6, color: '#6d766e' })
  ops.push({ kind: 'endGroup' }, { kind: 'group', name: 'fixtures' })
  for (const f of model.fixtures) { const p = tr(f.position); ops.push({ kind: 'rect', rect: { x: p.x - f.width / s / 2, y: p.y - f.depth / s / 2, w: f.width / s, h: f.depth / s }, color: '#9da79e', width: .18 }); if (f.type === 'floor_drain') ops.push(...symbolOps('floor_drain', p, '#777e77', .8)) }
  ops.push({ kind: 'endGroup' })
  for (const l of DRAWING_LAYERS.filter(l => layers.includes(l))) {
    const cfg = UTILITY_LAYERS[l]; ops.push({ kind: 'group', name: l })
    for (const r of model.utilities.filter(r => r.layer === l)) {
      const color = r.layer === 'electrical' ? model.circuits.find(c => c.id === r.circuitId)?.color : r.layer === 'water_supply' ? model.waterNetworks.find(n => n.id === r.networkId)?.color : r.layer === 'fire_alarm' ? model.zones.find(z => z.id === r.zoneId)?.color : cfg.color
      const points = r.path.map(tr); ops.push({ kind: 'poly', points, color: color ?? cfg.color, width: r.layer === 'drainage' ? .45 : .3, dash: cfg.dash ? cfg.dash.split(' ').map(Number).map(v => v / 5) : [], opacity: doc.layers[l].opacity })
      if (r.layer === 'drainage') { const seq = r.flowDirection === 'reverse' ? [...points].reverse() : points; for (let i = 1; i < seq.length; i++) if (Math.hypot(seq[i].x - seq[i - 1].x, seq[i].y - seq[i - 1].y) > 4) arrow(ops, seq[i - 1], { x: (seq[i].x + seq[i - 1].x) / 2, y: (seq[i].y + seq[i - 1].y) / 2 }, color ?? cfg.color) }
    }
    for (const sym of model.symbols.filter(sym => sym.layer === l)) ops.push(...symbolOps(sym.type, tr(sym.position), sym.type === 'exit_sign' ? '#258454' : cfg.color).map(op => ({ ...op, opacity: doc.layers[l].opacity })))
    ops.push({ kind: 'endGroup' })
  }
  if (doc.annotationsVisible) {
    ops.push({ kind: 'group', name: 'annotations' })
    for (const a of doc.annotations.filter(a => a.layer === 'annotations' || layers.includes(a.layer))) ops.push(...annotationOps(a, tr, s))
    if (doc.autoDimensions) for (const run of model.utilities.filter(r => layers.includes(r.layer))) {
      const p = tr(run.path[Math.floor(run.path.length / 2)])
      ops.push({ kind: 'text', at: { x: p.x + 2, y: p.y - 2 }, text: `${(lengthMm(run.path) / 1000).toFixed(2)} m run`, size: 2.2, color: ink })
      if (run.layer === 'drainage') ops.push(...annotationOps({ id: run.id, type: 'dimension', a: run.path[0], b: run.path.at(-1)!, layer: 'annotations', text: '', revisionId: null, units: 'mm' }, tr, s))
    }
    if (doc.pipeTags) for (const run of model.utilities.filter(r => layers.includes(r.layer))) { const p = tr(run.path[0]); ops.push({ kind: 'text', at: { x: p.x + 2, y: p.y + 3 }, text: pipeTag(run), size: 2.1, color: ink }) }
    ops.push({ kind: 'endGroup' })
  }
  if (layers.length > 1) { ops.push({ kind: 'group', name: 'clashes' }); for (const c of clashes) { const p = tr(c.position); ops.push({ kind: 'circle', at: p, r: 1.4, color: clashColor(c.severity), fill: clashColor(c.severity) }, { kind: 'text', at: { x: p.x, y: p.y + .7 }, text: '!', align: 'center', size: 2, color: 'white' }) } ops.push({ kind: 'endGroup' }) }
  ops.push({ kind: 'endClip' }); return ops
}

function frame(sheet: DrawingSheet, _model: UtilityFloor, doc: DrawingDocument, suffix: string) {
  const { w, h, ops } = sheet, s = doc.settings, margin = 10, tw = Math.min(170, w * .46), tx = w - margin - tw, ty = h - margin - 59
  const text = (x: number, y: number, value: string, size = 2.6, bold = false) => ops.push({ kind: 'text', at: { x, y }, text: value, size, color: ink, bold })
  ops.push({ kind: 'group', name: 'sheet-frame' }, { kind: 'rect', rect: { x: margin, y: margin, w: w - 20, h: h - 20 }, color: ink, width: .3 })
  for (let i = 0; i < 4; i++) { const x = margin + (w - 20) * (i + .5) / 4, y = margin + (h - 20) * (i + .5) / 4; text(x, 7.8, String.fromCharCode(65 + i)); text(x, h - 5, String.fromCharCode(65 + i)); text(5, y, String(i + 1)); text(w - 7, y, String(i + 1)); if (i) ops.push({ kind: 'line', a: { x: margin + (w - 20) * i / 4, y: margin }, b: { x: margin + (w - 20) * i / 4, y: margin + 2 }, color: ink, width: .2 }) }
  text(15, 18, 'FORMSTEAD / CONCEPT UTILITY DRAWING', 3.5, true); text(15, 24, `${sheet.title}${suffix}`, 3.3)
  ops.push({ kind: 'rect', rect: { x: tx, y: ty, w: tw, h: 59 }, color: ink, width: .3 })
  let y = ty + 4
  const field = (label: string, value: string, height = 8, font = 2.6) => { text(tx + 2, y, label.toUpperCase(), 1.8); const lines = wrap(value || '-', tw - 4, font); lines.slice(0, 2).forEach((line, i) => text(tx + 2, y + 3 + i * 3, line, font)); y += height; ops.push({ kind: 'line', a: { x: tx, y: y - 2 }, b: { x: tx + tw, y: y - 2 }, color: grey, width: .15 }) }
  field('Project / client', `${s.projectName} / ${s.client || 'Client not supplied'}`, 11)
  field('Drawing title', sheet.title, 11)
  field('Drawing no.', sheet.number, 8, 3)
  field('Scale / sheet / date', `${sheet.kind === 'plan' ? `1:${s.scale}` : 'NTS'} / ${s.size} ${s.orientation} / ${s.date}`, 8, 2.3)
  field('Drawn / checked', `${s.drawnBy || '-'} / ${s.checkedBy || 'Not checked'}`, 8, 2.3)
  text(tx + 2, y, `REV ${doc.revisions.at(-1)?.letter ?? '-'} / ${suffix.trim() || 'SHEET 1'}`, 2.2)
  ops.push({ kind: 'endGroup' })
  if (sheet.kind === 'plan') {
    const x = 18, y = h - 20, length = 2000 / s.scale
    ops.push({ kind: 'line', a: { x, y }, b: { x: x + length, y }, color: ink, width: .35 })
    for (const t of [0, 1, 2]) { const px = x + t * 1000 / s.scale; ops.push({ kind: 'line', a: { x: px, y: y - 1.5 }, b: { x: px, y: y + 1.5 }, color: ink, width: .2 }); text(px, y + 5, `${t}${t === 2 ? ' m' : ''}`, 2.3) }
    text(x, y - 5, `Print at 100% / actual size - 1:${s.scale}`, 2.3)
    const northX = sheet.tile!.viewport.x + sheet.tile!.viewport.w - 10
    ops.push({ kind: 'line', a: { x: northX, y: 48 }, b: { x: northX, y: 35 }, color: ink, width: .3 }); arrow(ops, { x: northX, y: 48 }, { x: northX, y: 35 }); text(northX - 22, 53, 'Plan up; north unverified', 2)
  }
  text(15, h - 12, 'Concept only. Verify heights, protection, slope and code requirements. Route lengths are not BOQ allowances.', 2)
  return { tx, ty, tw }
}

export function buildDrawingSheets(model: UtilityFloor, doc: DrawingDocument, layer: DrawingLayer, clashes: Clash[] = []): DrawingSheet[] {
  const paper = paperSize(doc.settings), rightW = Math.min(170, paper.w * .46), plot: Rect = { x: 15, y: 31, w: paper.w - 35 - rightW, h: paper.h - 66 }, s = doc.settings.scale, outline = model.floor.outline
  const cols = Math.max(1, Math.ceil((outline.w + 800) / (plot.w * s))), rows = Math.max(1, Math.ceil((outline.h + 800) / (plot.h * s)))
  if (cols * rows > 64) throw new Error('Too many tiles at this scale. Choose a larger sheet or 1:200.')
  const layers = layer === 'coordination' ? DRAWING_LAYERS.filter(l => doc.layers[l].visible) : [layer]
  const title = `${DRAWING_NAMES[layer]} - ${model.floor.name}`, number = drawingNumber(doc.settings, layer, model.floor.level), sheets: DrawingSheet[] = []
  const tables = schedules(model, layers), legendTypes = [...new Set(model.symbols.filter(sym => layers.includes(sym.layer)).map(sym => sym.type))]
  tables.push({ title: 'SYMBOL LEGEND', rows: legendTypes.map(type => `${type} - ${UTILITY_SYMBOLS[type].label}`) })
  tables.push({ title: 'REVISION REGISTER', rows: doc.revisions.length ? doc.revisions.map(r => `${r.letter} | ${r.date} | ${r.description} | ${r.by || '-'}`) : ['No revisions recorded.'] })
  const pending: { text: string; title: boolean; symbol?: string }[] = tables.flatMap(t => [{ text: t.title, title: true }, ...t.rows.flatMap(row => wrap(row, rightW - 10, 2.4).map((text, i) => ({ text, title: false, ...(t.title === 'SYMBOL LEGEND' && !i ? { symbol: row.split(' - ')[0] } : {}) }))), { text: '', title: false }])
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const tile = { viewport: plot, origin: { x: outline.x - 400 + col * plot.w * s, y: outline.y - 400 + row * plot.h * s }, scale: s, col, row, cols, rows }
    const sheet: DrawingSheet = { id: `${number}-${col}-${row}`, title, number, ...paper, kind: 'plan', layer, tile, ops: [] }
    sheet.ops.push(...planOps(model, doc, layers, tile, clashes))
    const bounds = frame(sheet, model, doc, ` / TILE ${row * cols + col + 1} OF ${cols * rows}`)
    let y = 34
    sheet.ops.push({ kind: 'group', name: 'schedules-legend-revisions' })
    // Every tile has its own legend/schedule; extra rows become continuation
    // sheets rather than disappearing or shrinking the drawing scale.
    const local = [...pending]
    while (local.length && y < bounds.ty - 4) { const line = local.shift()!; sheet.ops.push({ kind: 'text', at: { x: bounds.tx + 3 + (line.symbol ? 5 : 0), y }, text: line.text, size: line.title ? 2.7 : 2.4, color: ink, bold: line.title }); if (line.symbol) sheet.ops.push(...symbolOps(line.symbol, { x: bounds.tx + 4, y: y - .8 }, UTILITY_LAYERS[model.symbols.find(sym => sym.type === line.symbol)!.layer].color, 1)); y += line.title ? 6 : 4.2 }
    sheet.ops.push({ kind: 'endGroup' }); sheets.push(sheet)
    if (row === 0 && col === 0) while (local.length) {
      const page: DrawingSheet = { id: `${number}-schedule-${sheets.length}`, title: `${title} / Schedules continued`, number: `${number}-S${sheets.length}`, ...paper, kind: 'schedule', layer, ops: [] }
      const b = frame(page, model, doc, ' / CONTINUATION'); let py = 35
      while (local.length && py < b.ty - 4) { const line = local.shift()!; page.ops.push({ kind: 'text', at: { x: 18, y: py }, text: line.text, size: line.title ? 3.2 : 2.7, color: ink, bold: line.title }); if (line.symbol) page.ops.push(...symbolOps(line.symbol, { x: paper.w - 24, y: py - 1 }, ink)); py += 5 }
      sheets.push(page)
    }
  }
  return sheets
}

export function clashReportSheets(model: UtilityFloor, doc: DrawingDocument, clashes: Clash[]): DrawingSheet[] {
  const paper = paperSize(doc.settings), sheets: DrawingSheet[] = [], lines = clashes.flatMap(c => [`${c.id} | ${c.severity.toUpperCase()} | ${c.type} | ${c.status.toUpperCase()}`, ...wrap(`${c.rule} | ${c.roomIds.map(id => model.floor.rooms.find(r => r.id === id)?.name ?? id).join(', ')} | ${c.distance === null ? 'Distance N/A' : `${c.distance.toFixed(1)} mm ${c.distanceBasis}`} | ${c.certainty}`, paper.w - 40, 2.7), ...wrap(`${c.suggestion}${c.note ? ` / Note: ${c.note}` : ''}`, paper.w - 40, 2.7), ''])
  if (!lines.length) lines.push('No issues found by the current concept checks. This does not certify compliance.')
  while (lines.length) { const sheet: DrawingSheet = { id: `clashes-${sheets.length}`, number: `${doc.settings.projectCode}-CL-${String(model.floor.level + 1).padStart(3, '0')}-${sheets.length + 1}`, title: `Clash Review - ${model.floor.name}`, ...paper, kind: 'clashes', layer: 'coordination', ops: [] }; const b = frame(sheet, model, doc, ' / CLASH REPORT'); let y = 35; while (lines.length && y < b.ty - 5) { sheet.ops.push({ kind: 'text', at: { x: 17, y }, text: lines.shift()!, size: 2.7, color: ink }); y += 5 } sheets.push(sheet) }
  return sheets
}

export function drawingOpsSvg(ops: DrawOp[]) {
  let clips = 0
  return ops.map(op => {
    if (op.kind === 'group') return `<g id="${escapeXml(op.name)}" data-layer="${escapeXml(op.name)}">`
    if (op.kind === 'endGroup' || op.kind === 'endClip') return '</g>'
    if (op.kind === 'clip') { const id = `clip-${clips++}`; return `<defs><clipPath id="${id}"><rect x="${op.rect.x}" y="${op.rect.y}" width="${op.rect.w}" height="${op.rect.h}"/></clipPath></defs><g clip-path="url(#${id})">` }
    const style = `fill="${escapeXml(op.fill ?? 'none')}" stroke="${escapeXml(op.color ?? ink)}" stroke-width="${op.width ?? .2}" opacity="${op.opacity ?? 1}"${op.dash?.length ? ` stroke-dasharray="${op.dash.join(' ')}"` : ''}`
    if (op.kind === 'line') return `<line x1="${op.a.x}" y1="${op.a.y}" x2="${op.b.x}" y2="${op.b.y}" ${style}/>`
    if (op.kind === 'rect') return `<rect x="${op.rect.x}" y="${op.rect.y}" width="${op.rect.w}" height="${op.rect.h}" ${style}/>`
    if (op.kind === 'circle') return `<circle cx="${op.at.x}" cy="${op.at.y}" r="${op.r}" ${style}/>`
    if (op.kind === 'poly') return `<${op.closed ? 'polygon' : 'polyline'} points="${op.points.map(p => `${p.x},${p.y}`).join(' ')}" ${style}/>`
    return `<text x="${op.at.x}" y="${op.at.y}" font-size="${op.size}" font-weight="${op.bold ? 700 : 400}" text-anchor="${op.align === 'center' ? 'middle' : op.align === 'right' ? 'end' : 'start'}" fill="${op.color ?? ink}" opacity="${op.opacity ?? 1}">${escapeXml(op.text)}</text>`
  }).join('')
}
export function sheetSvg(sheet: DrawingSheet) {
  const data = drawingOpsSvg(sheet.ops)
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${sheet.w}mm" height="${sheet.h}mm" viewBox="0 0 ${sheet.w} ${sheet.h}" font-family="Arial,sans-serif"><title>${escapeXml(sheet.title)}</title><rect width="${sheet.w}" height="${sheet.h}" fill="white"/>${data}</svg>`
}
