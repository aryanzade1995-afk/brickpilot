import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { DRAWING_PRESETS, drawingLayerCounts, terraceLayerCounts } from '../src/lib/draw/layers.ts'
import { openSpaceBrief } from './fixtures/open-space-brief.mjs'

const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, watch: null }, appType: 'custom' })
after(() => server.close())
const { FloorDrawing, TerraceDrawing } = await server.ssrLoadModule('/src/lib/draw/FloorDrawing.tsx')
const d = generate(compile(openSpaceBrief('maxBuild')))
const render = (floor, layers, theme = 'paper') => renderToStaticMarkup(React.createElement(FloorDrawing,
  { floor, model: d.model, siteFeatures: d.siteFeatures, layers, theme }))

test('all presets and both themes render every floor without changing verified geometry', () => {
  const before = JSON.stringify(d)
  for (const theme of ['paper', 'cad']) for (const layers of Object.values(DRAWING_PRESETS)) for (const floor of d.floors) {
    const svg = render(floor, layers, theme)
    assert.ok(svg.startsWith('<svg'))
    assert.ok(svg.includes(theme === 'cad' ? '#11161c' : '#ffffff'))
  }
  assert.equal(JSON.stringify(d), before)
  assert.ok(validate(d).hardChecksPass)
})

test('hiding layers removes annotations while preserving the original openings in visible walls', () => {
  const off = Object.fromEntries(Object.keys(DRAWING_PRESETS.Validation).map(k => [k, false]))
  const blank = render(d.floors[0], off)
  for (const id of ['site', 'zoning', 'circulation', 'walls', 'openings', 'supports', 'columns', 'labels', 'dimensions', 'furniture']) assert.ok(!blank.includes(`data-layer="${id}"`), id)
  const walls = render(d.floors[0], { ...off, walls: true })
  assert.ok(walls.includes('data-layer="walls"'))
  assert.ok(!walls.includes('data-layer="openings"'))
  assert.equal((walls.match(/stroke-width="340"/g) ?? []).length, d.floors[0].openings.length)
})

test('supports renders real beams and pillars without walls or furniture', () => {
  const floor = d.floors[0], svg = render(floor, { ...DRAWING_PRESETS.Architectural, walls: false, supports: true })
  assert.ok(svg.includes('data-layer="supports"'))
  assert.ok(svg.includes('data-layer="columns"'))
  assert.ok(!svg.includes('data-layer="walls"'))
  assert.ok(!svg.includes('data-layer="furniture"'))
  assert.equal(drawingLayerCounts(floor, d.siteFeatures).supports, floor.beams.length + floor.columns.length)
  assert.equal(drawingLayerCounts(d.floors[1], d.siteFeatures).site, 2)
})

test('validation shows zones and existing access edges; presentation supplies furniture without trees', () => {
  const floor = d.floors[0], svg = render(floor, DRAWING_PRESETS.Validation, 'cad')
  for (const id of ['zoning', 'circulation', 'openings', 'supports']) assert.ok(svg.includes(`data-layer="${id}"`), id)
  const presentation = render(floor, DRAWING_PRESETS.Presentation)
  assert.ok(presentation.includes('data-layer="furniture"'))
  assert.ok(!presentation.includes('tree'))
  assert.ok(drawingLayerCounts(floor).furniture > 0)
})

test('terrace theme and layer controls use the source roof and structural data', () => {
  const before = JSON.stringify(d)
  const svg = renderToStaticMarkup(React.createElement(TerraceDrawing, { design: d, theme: 'cad', layers: DRAWING_PRESETS.Validation }))
  for (const id of ['site', 'circulation', 'supports', 'dimensions']) assert.ok(svg.includes(`data-layer="${id}"`), id)
  assert.equal(terraceLayerCounts(d).supports, d.floors.at(-1).beams.length + d.floors.at(-1).columns.length)
  assert.equal(JSON.stringify(d), before)
})
