import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { utilityFloor } from '../src/lib/utilities/plan.ts'
import { detectClashes, reviewClash } from '../src/lib/utilities/clashes.ts'
import { defaultDrawing, nextRevision, paperSize, drawingNumber, dimensionText, sourceSignature, parseUtilityDrawing, lengthMm, SHEET_SIZES, DRAWING_LAYERS } from '../src/lib/utilities/drawingProject.ts'
import { buildDrawingSheets, clashReportSheets, sheetSvg, annotationOps, cloudPoints, schedules, pipeTag } from '../src/lib/utilities/drawingSheets.ts'
import { utilityDxf, vectorSheetPdf, withPngDpi } from '../src/lib/utilities/drawingExports.ts'

const design = generate(compile(defaultBrief())), model = utilityFloor(design, 0), doc = defaultDrawing('Test Villa')
const snapshot = (m = model, d = doc) => ({ format: 'formstead-utility-project', version: 1, savedAt: '2026-10-21T00:00:00.000Z', sourceSignature: sourceSignature(m), model: m, document: d, reviews: {}, view: { room: 'all', circuit: 'all', zone: 'all', water: 'all', showClashes: true, showCoverage: false, showEvacuation: false } })

test('all sizes/orientations/scales retain physical mm and tile coverage without silently fitting', () => {
  for (const size of Object.keys(SHEET_SIZES)) for (const orientation of ['landscape', 'portrait']) for (const scale of [50, 100, 200]) {
    const settings = { ...doc.settings, size, orientation, scale }, d = { ...doc, settings }, sheets = buildDrawingSheets(model, d, 'drainage'), plans = sheets.filter(s => s.kind === 'plan'), paper = paperSize(settings)
    for (const sheet of sheets) assert.deepEqual([sheet.w, sheet.h], [paper.w, paper.h])
    assert.ok(plans.every(s => s.tile.scale === scale))
    assert.ok(Math.max(...plans.map(s => s.tile.origin.x + s.tile.viewport.w * scale)) >= model.floor.outline.x + model.floor.outline.w)
    assert.ok(Math.max(...plans.map(s => s.tile.origin.y + s.tile.viewport.h * scale)) >= model.floor.outline.y + model.floor.outline.h)
    const bar = plans[0].ops.find(o => o.kind === 'line' && o.a.x === 18 && o.a.y === paper.h - 20 && o.b.y === paper.h - 20)
    assert.ok(Math.abs(bar.b.x - bar.a.x - 2000 / scale) < 1e-9)
    const wall = plans[0].ops.find(o => o.kind === 'line' && o.color === '#b5bbb6'), source = model.floor.walls[0], tile = plans[0].tile
    assert.ok(Math.abs(wall.a.x - (tile.viewport.x + (source.a.x - tile.origin.x) / scale)) < 1e-9)
  }
})

test('layer-derived titles/numbers, revision register and full title fields are printed on every page', () => {
  const d = structuredClone(doc); d.settings.client = 'Client & Partner <name>'; d.settings.drawnBy = 'Drafter'; d.settings.checkedBy = ''
  d.revisions.push({ id: 'rev-a', letter: 'A', date: '2026-10-21', description: 'Reviewed visible utility positions', by: 'AB' })
  for (const layer of [...DRAWING_LAYERS, 'coordination']) {
    const sheets = buildDrawingSheets(model, d, layer)
    assert.equal(sheets[0].number, drawingNumber(d.settings, layer, model.floor.level))
    for (const sheet of sheets) {
      const labels = sheet.ops.filter(o => o.kind === 'text').map(o => o.text).join('\n')
      for (const expected of ['PROJECT', 'CLIENT', 'DRAWING TITLE', 'DRAWING NO.', 'SCALE / SHEET / DATE', 'DRAWN / CHECKED', 'REV A /', 'Client & Partner <name>', 'Not checked']) assert.ok(labels.includes(expected), expected)
      const svg = sheetSvg(sheet); assert.ok(svg.includes(`width="${sheet.w}mm"`)); assert.ok(svg.includes('Client &amp; Partner &lt;name&gt;')); assert.ok(!svg.includes('<script'))
    }
  }
  const legend = buildDrawingSheets(model, d, 'drainage').flatMap(s => s.ops).filter(o => o.kind === 'text').map(o => o.text).join('\n')
  assert.ok(legend.includes('layer_drainage - Drainage / dashed'))
  assert.ok(legend.includes('fixture_floor_drain - Floor drain / drain point'))
})

test('manual dimensions are numeric measurements; clouds are bounded and revision letters continue past Z', () => {
  const a = { x: 0, y: 0 }, b = { x: 3000, y: 4000 }
  assert.equal(dimensionText(a, b, 'mm'), '5000 mm'); assert.equal(dimensionText(a, b, 'm'), '5.000 m')
  assert.equal(nextRevision([]), 'A'); assert.equal(nextRevision([{ letter: 'Z' }]), 'AA'); assert.equal(nextRevision([{ letter: 'AZ' }]), 'BA')
  const ops = annotationOps({ id: 'a', type: 'dimension', a, b, text: '', units: 'mm', layer: 'annotations', revisionId: null }, p => ({ x: p.x / 100, y: p.y / 100 }))
  assert.ok(ops.some(op => op.kind === 'text' && op.text === '5000 mm')); assert.equal(ops.filter(op => op.kind === 'line').length, 3)
  assert.ok(cloudPoints(a, b, 120).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
})

test('JSON round trips complete routes, layer preferences, annotations, revisions, settings and reviewed clashes', () => {
  const d = structuredClone(doc); d.layers.electrical.opacity = .4; d.layers.drainage.locked = true; d.layers.fire_alarm.visible = false
  d.revisions.push({ id: 'revision-a', letter: 'A', date: '2026-10-21', description: 'Added drawing note', by: '' })
  d.annotations.push({ id: 'cloud', type: 'cloud', a: { x: 0, y: 0 }, b: { x: 3000, y: 3000 }, text: 'Review wet room', revisionId: 'revision-a', layer: 'annotations', units: 'mm' })
  const saved = snapshot(model, d), clash = detectClashes(model)[0]
  saved.reviews[clash.id] = reviewClash(clash, 'ignored', 'A reason recorded by the reviewer')
  const parsed = parseUtilityDrawing(JSON.parse(JSON.stringify(saved)))
  assert.deepEqual(parsed.model.utilities, model.utilities); assert.deepEqual(parsed.document, d); assert.deepEqual(parsed.reviews, saved.reviews)
  assert.equal(sourceSignature(parsed.model), saved.sourceSignature)
  for (const floor of design.floors) parseUtilityDrawing(snapshot(utilityFloor(design, floor.level)))
})

test('invalid, tampered, non-orthogonal and referentially broken imports are rejected before changing data', () => {
  const bad = structuredClone(snapshot()); bad.version = 99; assert.throws(() => parseUtilityDrawing(bad))
  const missing = structuredClone(snapshot()); missing.model.utilities.find(r => r.layer === 'electrical').circuitId = 'missing'; missing.sourceSignature = sourceSignature(missing.model); assert.throws(() => parseUtilityDrawing(missing))
  const diagonal = structuredClone(snapshot()); diagonal.model.utilities[0].path = [{ x: 0, y: 0 }, { x: 100, y: 100 }]; diagonal.sourceSignature = sourceSignature(diagonal.model); assert.throws(() => parseUtilityDrawing(diagonal), /orthogonal/)
  const mismatch = structuredClone(snapshot()); mismatch.model.utilities[0].path[0].x += 10; assert.throws(() => parseUtilityDrawing(mismatch))
})

test('schedules use canonical quantities and explicitly avoid invented wattages or drain slopes', () => {
  const tables = schedules(model, DRAWING_LAYERS)
  const drainRows = tables.find(t => t.title.startsWith('DRAINAGE')).rows
  assert.equal(drainRows.length, model.utilities.filter(r => r.layer === 'drainage').length)
  const run = model.utilities.find(r => r.layer === 'drainage')
  assert.ok(drainRows[0].includes((lengthMm(run.path) / 1000).toFixed(2)))
  assert.ok(tables.find(t => t.title.startsWith('ELECTRICAL')).rows.every(r => r.includes('watts unknown')))
  assert.match(pipeTag(run), /slope unverified/); assert.doesNotMatch(pipeTag(run), /1:60/)
})

test('clean SVG has named service groups, escaped notes and a separately toggled annotations group', () => {
  const d = structuredClone(doc); d.annotations.push({ id: 'note', type: 'note', a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, text: '<script>alert(1)</script>', units: 'mm', layer: 'annotations', revisionId: null })
  const svg = sheetSvg(buildDrawingSheets(model, d, 'coordination')[0])
  for (const layer of [...DRAWING_LAYERS, 'walls', 'fixtures', 'annotations']) assert.ok(svg.includes(`data-layer="${layer}"`))
  assert.ok(svg.includes('&lt;script&gt;')); assert.ok(!svg.includes('<script>'))
  d.annotationsVisible = false; assert.ok(!sheetSvg(buildDrawingSheets(model, d, 'coordination')[0]).includes('&lt;script&gt;'))
})

test('DXF exports real mm coordinates on true-colour layers, doors, symbols and annotations', () => {
  const d = structuredClone(doc); d.annotations.push({ id: 'note', type: 'note', a: { x: 1000, y: 2000 }, b: { x: 1000, y: 2000 }, text: 'Utility note', units: 'mm', layer: 'annotations', revisionId: null })
  const dxf = utilityDxf(model, d), values = dxf.split('\r\n')
  assert.match(dxf, /\$INSUNITS\r\n70\r\n4/)
  for (const layer of [...DRAWING_LAYERS, 'walls', 'fixtures', 'annotations']) assert.ok(values.includes(layer))
  assert.match(dxf, /\r\n420\r\n/); assert.doesNotMatch(dxf, /NaN|undefined/); assert.ok(dxf.includes('AcDbPolyline')); assert.ok(dxf.includes('*Model_Space')); assert.ok(dxf.includes('Utility note')); assert.ok(dxf.includes('\r\n-2000\r\n'))
  assert.equal(values.at(-2), 'EOF')
})

test('PDF remains vector and matches custom physical paper size, including the clash appendix', async () => {
  const d = structuredClone(doc); d.settings.size = 'A3'; d.settings.scale = 200
  const sheets = [...buildDrawingSheets(model, d, 'drainage'), ...clashReportSheets(model, d, detectClashes(model).slice(0, 3))]
  const pdf = await vectorSheetPdf(sheets), bytes = Buffer.from(pdf.output('arraybuffer'))
  assert.equal(pdf.getNumberOfPages(), sheets.length)
  assert.ok(Math.abs(pdf.internal.pageSize.getWidth() - 420) < .001); assert.ok(Math.abs(pdf.internal.pageSize.getHeight() - 297) < .001)
  assert.ok(!bytes.toString('latin1').includes('/Subtype /Image'), 'Vector sheets must not contain raster page captures')
})

test('PNG metadata stores requested physical DPI and replaces earlier pHYs values', () => {
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh1sAAAAASUVORK5CYII=', 'base64'))
  const result = withPngDpi(withPngDpi(png, 150), 300), data = new DataView(result.buffer)
  assert.equal(data.getUint32(41), Math.round(300 / .0254)); assert.equal(result[49], 1)
  assert.equal(Buffer.from(result).toString('latin1').split('pHYs').length - 1, 1)
})

test('drawing generation and export never mutate architecture, utility paths, accepted seed or costs', () => {
  const before = JSON.stringify({ design, model, doc })
  buildDrawingSheets(model, doc, 'coordination'); utilityDxf(model, doc)
  assert.equal(JSON.stringify({ design, model, doc }), before)
})
