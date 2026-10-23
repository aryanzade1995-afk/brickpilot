import { saveBlob } from '../export/fileSaver.ts'
import { DRAWING_LAYERS, type DrawingDocument } from './drawingProject.ts'
import { sheetSvg, symbolOps, drainageNodeOps, annotationOps, type DrawOp, type DrawingSheet } from './drawingSheets.ts'
import { DRAINAGE_COLORS } from './drainageRules.ts'
import { UTILITY_LAYERS, type UtilityFloor } from './plan.ts'

let fontPromise: Promise<string> | undefined
function unicodeFont() {
  fontPromise ??= fetch('/fonts/NotoSansDevanagari-Regular.ttf').then(async r => { if (!r.ok) throw new Error('The PDF font could not be loaded. Please retry.'); const bytes = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s) }).catch(e => { fontPromise = undefined; throw e })
  return fontPromise
}
/** Native vector PDF, shared primitives with SVG. No canvas screenshot or fit
 * scaling. Paper dimensions and source-plan-to-paper ratio stay exact. */
export async function vectorSheetPdf(sheets: DrawingSheet[], suppliedFont?: string) {
  if (!sheets.length) throw new Error('There are no sheets to export.')
  const { jsPDF, GState } = await import('jspdf')
  const first = sheets[0], pdf = new jsPDF({ unit: 'mm', format: [first.w, first.h], orientation: first.w > first.h ? 'landscape' : 'portrait', compress: true, putOnlyUsedFonts: true })
  const unicode = sheets.some(s => s.ops.some(op => op.kind === 'text' && /[\u0900-\u097f]/.test(op.text)))
  if (unicode) { pdf.addFileToVFS('NotoSansDevanagari.ttf', suppliedFont ?? await unicodeFont()); pdf.addFont('NotoSansDevanagari.ttf', 'Noto', 'normal') }
  for (const [index, sheet] of sheets.entries()) {
    if (index) pdf.addPage([sheet.w, sheet.h], sheet.w > sheet.h ? 'landscape' : 'portrait')
    pdf.setFillColor('#ffffff'); pdf.rect(0, 0, sheet.w, sheet.h, 'F')
    for (const op of sheet.ops) {
      if (op.kind === 'group' || op.kind === 'endGroup') continue
      if (op.kind === 'clip') { pdf.saveGraphicsState(); pdf.rect(op.rect.x, op.rect.y, op.rect.w, op.rect.h, null); pdf.clip(); pdf.discardPath(); continue }
      if (op.kind === 'endClip') { pdf.restoreGraphicsState(); continue }
      pdf.setGState(new GState({ opacity: op.opacity ?? 1, 'stroke-opacity': op.opacity ?? 1 }))
      pdf.setDrawColor(op.color ?? '#323832'); pdf.setLineWidth(op.width ?? .2); pdf.setLineDashPattern(op.dash ?? [], 0)
      if (op.fill) pdf.setFillColor(op.fill)
      const style = op.fill && op.fill !== 'none' ? 'FD' : 'S'
      if (op.kind === 'line') pdf.line(op.a.x, op.a.y, op.b.x, op.b.y)
      else if (op.kind === 'rect') pdf.rect(op.rect.x, op.rect.y, op.rect.w, op.rect.h, style)
      else if (op.kind === 'circle') pdf.circle(op.at.x, op.at.y, op.r, style)
      else if (op.kind === 'poly') { if (op.points.length > 1) pdf.lines(op.points.slice(1).map((p, i) => [p.x - op.points[i].x, p.y - op.points[i].y]), op.points[0].x, op.points[0].y, [1, 1], style, !!op.closed) }
      else {
        // The bundled Devanagari subset does not contain Latin letters. An
        // arrow/dash must never switch the entire sheet to that font and erase
        // English. Select font per script run; retain real text in the PDF.
        const text = op.text.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\u2192/g, ' -> ').replace(/\u2190/g, ' <- ').replace(/\u2026/g, '...').replace(/\u2264/g, '<=').replace(/\u2265/g, '>=').replace(/\u2191/g, '^')
        if (/[^\x20-\xff\u0900-\u097f\u200c\u200d\n]/.test(text)) throw new Error('This PDF contains unsupported text characters. Use SVG to preserve that text or simplify the drawing labels.')
        const runs = text.split(/([\u0900-\u097f\u200c\u200d]+)/).filter(Boolean).map(value => ({ value, devanagari: /[\u0900-\u097f]/.test(value) }))
        pdf.setFontSize(op.size * 72 / 25.4); pdf.setTextColor(op.color ?? '#323832')
        const font = (devanagari: boolean) => pdf.setFont(devanagari ? 'Noto' : 'helvetica', devanagari ? 'normal' : op.bold ? 'bold' : 'normal')
        const widths = runs.map(r => { font(r.devanagari); return pdf.getTextWidth(r.value) }), total = widths.reduce((n, w) => n + w, 0)
        let x = op.at.x - (op.align === 'center' ? total / 2 : op.align === 'right' ? total : 0)
        runs.forEach((r, i) => { font(r.devanagari); pdf.text(r.value, x, op.at.y); x += widths[i] })
      }
    }
  }
  return pdf
}
export async function downloadVectorSheets(sheets: DrawingSheet[], name: string) { (await vectorSheetPdf(sheets)).save(`${name}.pdf`) }
export function downloadSheetSvg(sheet: DrawingSheet) { saveBlob(new Blob([sheetSvg(sheet)], { type: 'image/svg+xml;charset=utf-8' }), `${sheet.number}.svg`) }

// PNG pHYs records true output DPI, in addition to exact pixel dimensions.
export function withPngDpi(bytes: Uint8Array, dpi: number) {
  const payload = new Uint8Array(9), data = new DataView(payload.buffer), ppm = Math.round(dpi / .0254)
  data.setUint32(0, ppm); data.setUint32(4, ppm); payload[8] = 1
  const type = new TextEncoder().encode('pHYs'), crcBytes = new Uint8Array([...type, ...payload]); let crc = 0xffffffff
  for (const byte of crcBytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1 }
  const chunk = new Uint8Array(21), view = new DataView(chunk.buffer); view.setUint32(0, 9); chunk.set(type, 4); chunk.set(payload, 8); view.setUint32(17, (crc ^ 0xffffffff) >>> 0)
  const chunks: Uint8Array[] = [bytes.slice(0, 33), chunk]; let offset = 33
  while (offset < bytes.length) { const len = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0), name = String.fromCharCode(...bytes.slice(offset + 4, offset + 8)); if (name !== 'pHYs') chunks.push(bytes.slice(offset, offset + len + 12)); offset += len + 12 }
  const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let at = 0; for (const c of chunks) { result.set(c, at); at += c.length } return result
}
export async function downloadSheetPng(sheet: DrawingSheet, dpi: 150 | 300) {
  const width = Math.round(sheet.w / 25.4 * dpi), height = Math.round(sheet.h / 25.4 * dpi)
  if (width * height > 85000000) throw new Error('This image is too large for a safe browser export. Choose 150 DPI or vector PDF.')
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d'); if (!context) throw new Error('PNG export is unavailable. Try SVG or PDF.')
  const url = URL.createObjectURL(new Blob([sheetSvg(sheet)], { type: 'image/svg+xml' }))
  try { const img = new Image(); img.src = url; await img.decode(); context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(img, 0, 0, width, height); const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG export failed. Try 150 DPI.')), 'image/png')); const bytes = withPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi); saveBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }), `${sheet.number}-${dpi}dpi.png`) } finally { URL.revokeObjectURL(url); canvas.width = 1; canvas.height = 1 }
}

/** DXF model space: 1 unit = 1 mm. Plan y-down becomes CAD y-up. Export all
 * actual service paths, independent of room/circuit and sheet tile filters. */
export function utilityDxf(model: UtilityFloor, doc: DrawingDocument) {
  const out: string[] = [], put = (...v: (string | number)[]) => out.push(...v.map(String)), clean = (s: string) => s.replace(/[\r\n\u0000-\u001f]/g, ' ').replace(/[^\x20-\x7e]/g, c => `\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
  const colors: Record<string, string> = { '0': '#000000', walls: '#b5bbb6', fixtures: '#777e77', annotations: '#3f655a', ...Object.fromEntries(DRAWING_LAYERS.map(k => [k, UTILITY_LAYERS[k].color])) }
  const trueColor = (color: string) => color === 'white' ? 0xffffff : color === 'black' ? 0 : parseInt(color.replace('#', ''), 16)
  let serial = 0x100
  const handle = () => (serial++).toString(16).toUpperCase()
  put(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1015', 9, '$HANDSEED', 5, 'FFFF', 9, '$INSUNITS', 70, 4, 9, '$MEASUREMENT', 70, 1, 9, '$ACADCODEPAGE', 3, 'ANSI_1252', 0, 'ENDSEC', 0, 'SECTION', 2, 'TABLES')
  put(0, 'TABLE', 2, 'LTYPE', 5, '1', 100, 'AcDbSymbolTable', 70, 4)
  for (const name of ['BYBLOCK', 'BYLAYER', 'CONTINUOUS', 'DASHED']) {
    put(0, 'LTYPE', 5, handle(), 330, '1', 100, 'AcDbSymbolTableRecord', 100, 'AcDbLinetypeTableRecord', 2, name, 70, 0, 3, name, 72, 65, 73, name === 'DASHED' ? 2 : 0, 40, name === 'DASHED' ? 300 : 0)
    if (name === 'DASHED') put(49, 200, 74, 0, 49, -100, 74, 0)
  }
  put(0, 'ENDTAB', 0, 'TABLE', 2, 'LAYER', 5, '2', 100, 'AcDbSymbolTable', 70, Object.keys(colors).length)
  for (const [name, color] of Object.entries(colors)) {
    const pref = doc.layers[name as keyof typeof doc.layers]
    put(0, 'LAYER', 5, handle(), 330, '2', 100, 'AcDbSymbolTableRecord', 100, 'AcDbLayerTableRecord', 2, name, 70, pref?.locked ? 4 : 0, 62, pref && !pref.visible ? -7 : ({ drainage: 33, electrical: 1, fire_alarm: 30, water_supply: 5 } as Record<string, number>)[name] ?? 7, 420, trueColor(color), 6, name === 'drainage' || name === 'fire_alarm' ? 'DASHED' : 'CONTINUOUS')
  }
  put(0, 'ENDTAB', 0, 'TABLE', 2, 'STYLE', 5, '3', 100, 'AcDbSymbolTable', 70, 1, 0, 'STYLE', 5, '4', 330, '3', 100, 'AcDbSymbolTableRecord', 100, 'AcDbTextStyleTableRecord', 2, 'STANDARD', 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 2.5, 3, 'arial.ttf', 4, '', 0, 'ENDTAB')
  put(0, 'TABLE', 2, 'BLOCK_RECORD', 5, '9', 100, 'AcDbSymbolTable', 70, 2)
  for (const [id, name] of [['A', '*Model_Space'], ['B', '*Paper_Space']]) put(0, 'BLOCK_RECORD', 5, id, 330, '9', 100, 'AcDbSymbolTableRecord', 100, 'AcDbBlockTableRecord', 2, name, 70, 0)
  put(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'BLOCKS')
  for (const [owner, begin, end, name] of [['A', 'D', 'E', '*Model_Space'], ['B', 'F', '10', '*Paper_Space']]) {
    put(0, 'BLOCK', 5, begin, 330, owner, 100, 'AcDbEntity', 8, '0', 100, 'AcDbBlockBegin', 2, name, 70, 0, 10, 0, 20, 0, 30, 0, 3, name, 1, '', 0, 'ENDBLK', 5, end, 330, owner, 100, 'AcDbEntity', 8, '0', 100, 'AcDbBlockEnd')
  }
  put(0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES')
  const entity = (op: DrawOp, name: string) => {
    const common = (subclass: string) => put(5, handle(), 330, 'A', 100, 'AcDbEntity', 8, name, 420, trueColor(op.color ?? colors[name]), 6, op.dash?.length ? 'DASHED' : 'BYLAYER', 100, subclass)
    if (op.kind === 'line') { put(0, 'LINE'); common('AcDbLine'); put(10, op.a.x, 20, -op.a.y, 30, 0, 11, op.b.x, 21, -op.b.y, 31, 0) }
    if (op.kind === 'poly') { put(0, 'LWPOLYLINE'); common('AcDbPolyline'); put(90, op.points.length, 70, op.closed ? 1 : 0); for (const p of op.points) put(10, p.x, 20, -p.y) }
    if (op.kind === 'rect') entity({ ...op, kind: 'poly', points: [{ x: op.rect.x, y: op.rect.y }, { x: op.rect.x + op.rect.w, y: op.rect.y }, { x: op.rect.x + op.rect.w, y: op.rect.y + op.rect.h }, { x: op.rect.x, y: op.rect.y + op.rect.h }], closed: true }, name)
    if (op.kind === 'circle') { put(0, 'CIRCLE'); common('AcDbCircle'); put(10, op.at.x, 20, -op.at.y, 30, 0, 40, op.r) }
    if (op.kind === 'text') { put(0, 'TEXT'); common('AcDbText'); put(10, op.at.x, 20, -op.at.y, 30, 0, 40, op.size, 1, clean(op.text), 7, 'STANDARD'); if (op.align === 'center') put(72, 1, 11, op.at.x, 21, -op.at.y, 31, 0) }
  }
  for (const w of model.wallSections.filter(w => w.base === 0)) entity({ kind: 'line', a: w.a, b: w.b, color: colors.walls }, 'walls')
  for (const o of model.floor.openings) entity({ kind: 'text', at: o.at, text: `${o.kind} ${o.width}mm`, size: 90, color: '#888888' }, 'walls')
  for (const f of model.fixtures) entity({ kind: 'rect', rect: { x: f.position.x - f.width / 2, y: f.position.y - f.depth / 2, w: f.width, h: f.depth }, color: colors.fixtures }, 'fixtures')
  for (const r of model.utilities) entity({ kind: 'poly', points: r.path, color: r.layer === 'drainage' && r.drainagePipe ? DRAINAGE_COLORS[r.drainagePipe.service] : colors[r.layer], dash: UTILITY_LAYERS[r.layer].dash ? [200, 100] : [] }, r.layer)
  for (const s of model.symbols.filter(s => !(s.layer === 'drainage' && model.drainageDesign))) for (const op of symbolOps(s.type, s.position, colors[s.layer], 100)) entity(op, s.layer)
  for (const n of model.drainageDesign?.nodes ?? []) for (const op of drainageNodeOps(n, p => p, 100)) entity(op, 'drainage')
  for (const a of doc.annotations) for (const op of annotationOps(a, p => ({ x: p.x / doc.settings.scale, y: p.y / doc.settings.scale }))) {
    const scaled = { ...op } as DrawOp
    const multiply = (p: { x: number; y: number }) => ({ x: p.x * doc.settings.scale, y: p.y * doc.settings.scale })
    if (scaled.kind === 'line') { scaled.a = multiply(scaled.a); scaled.b = multiply(scaled.b) } else if (scaled.kind === 'poly') scaled.points = scaled.points.map(multiply); else if (scaled.kind === 'text') { scaled.at = multiply(scaled.at); scaled.size *= doc.settings.scale } entity(scaled, 'annotations')
  }
  put(0, 'ENDSEC', 0, 'SECTION', 2, 'OBJECTS', 0, 'DICTIONARY', 5, 'C', 330, '0', 100, 'AcDbDictionary', 281, 1, 0, 'ENDSEC', 0, 'EOF'); return out.join('\r\n') + '\r\n'
}
export function downloadUtilityDxf(model: UtilityFloor, doc: DrawingDocument) { saveBlob(new Blob([utilityDxf(model, doc)], { type: 'application/dxf' }), `${doc.settings.projectCode}-utilities-floor-${model.floor.level}.dxf`) }
