import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { traceSketch } from '../server/sketch-reader.mjs'
import { handleExistingPlan } from '../server/existing-plan.mjs'
import { surveySchema, scaleDrawing, withDefaults, defaultPlot, measuredStructure } from '../src/lib/existing/survey.ts'
import { defaultAnswers } from '../src/lib/existing/types.ts'
import { planAroundStructure } from '../src/lib/existing/plan.ts'

// The labels are what the local vision model read from each drawing, saved so the test needs no model running.
const python = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import cv2, numpy'])
const skip = python.status !== 0 && 'Python with OpenCV is not installed'
const F = 'scripts/fixtures/sketches/'

async function plan(image, labels) {
  const draft = await traceSketch(F + image, F + labels)
  const survey = withDefaults(scaleDrawing(surveySchema.parse(draft), draft.widthM, draft.depthM))
  const plot = defaultPlot(draft.widthM, draft.depthM)
  const answers = { ...defaultAnswers(), plotWidthM: plot.widthM, plotDepthM: plot.depthM, floorHeightM: survey.heightM, storeysWanted: 1, storeysBuilt: 1, roadSide: 'S', parking: false }
  const built = measuredStructure(survey, answers, true)
  const rooms = built.structure.measuredPlan.rooms
  Object.assign(answers, { bedroomsWithBath: 0, bedroomsNoBath: rooms.filter((r) => r.zone === 'private').length, sharedBaths: rooms.filter((r) => r.id.startsWith('bath')).length, studies: rooms.filter((r) => r.zone === 'work').length })
  return { draft, survey, result: planAroundStructure(built, answers, 1) }
}
const blocking = (p) => [...p.rules.findings, ...p.existing.findings].filter((f) => f.severity === 'error').map((f) => `${f.code} ${f.message}`)

for (const labels of ['contractor-30x40.labels.json', 'contractor-30x40.labels-alt.json'])
  test(`contractor sketch (${labels}): 30' x 40' read to scale, every room and door, valid 2D plan`, { skip }, async () => {
    const { draft, survey, result } = await plan('contractor-30x40.webp', labels)
    assert.ok(Math.abs(draft.widthM - 30 * 0.3048) < 0.5, `width ${draft.widthM}`)   // wall centre to wall centre
    assert.ok(Math.abs(draft.depthM - 40 * 0.3048) < 0.8, `depth ${draft.depthM}`)
    const types = survey.rooms.map((r) => r.type).sort()
    assert.equal(types.filter((t) => t === 'bed').length, 3)
    assert.equal(types.filter((t) => t === 'bath').length, 2)
    assert.ok(types.includes('kitchen') && types.includes('living'))
    assert.equal(survey.openings.filter((o) => o.kind === 'entry').length, 1, 'the main entrance facing the gate')
    assert.ok(survey.openings.filter((o) => o.kind === 'window').length >= 6)
    assert.ok(survey.columns.length >= 4 && survey.walls.every((w) => w.thicknessMm) && survey.openings.every((o) => o.headM))
    assert.ok(result.ok)
    assert.deepEqual(blocking(result), [])
    assert.ok(result.valid)
  })

test('a different hand (metric labels, single-line windows, ROAD note) also becomes a valid plan', { skip }, async () => {
  const { draft, survey, result } = await plan('two-bed-10x12m.png', 'two-bed-10x12m.labels.json')
  assert.ok(Math.abs(draft.widthM - 10) < 0.5 && Math.abs(draft.depthM - 12) < 0.8, `${draft.widthM} x ${draft.depthM}`)
  for (const t of ['bed', 'bath', 'kitchen', 'study', 'living']) assert.ok(survey.rooms.some((r) => r.type === t), t)
  assert.deepEqual(blocking(result), [])
})

test('the drawing endpoint returns the reader draft, and a reader failure is reported, never invented', async () => {
  const run = async (reader) => {
    let status, body
    const res = { writeHead: (s) => { status = s }, end: (b) => { body = JSON.parse(b) } }
    await handleExistingPlan({ method: 'POST', url: '/api/existing-plan/read' }, res, async () => ({ imageBase64: 'aGVsbG8=', mimeType: 'image/png' }), reader)
    return { status, body }
  }
  const ok = await run(async () => ({ widthM: 9, depthM: 12, heightM: null, columns: [], footings: [], beams: [], walls: [], rooms: [], openings: [], notes: [] }))
  assert.equal(ok.status, 200); assert.equal(ok.body.draft.widthM, 9)
  const failed = await run(async () => { throw new Error('Ollama is not running') })
  assert.equal(failed.status, 503); assert.match(failed.body.error, /Ollama is not running/)
})
