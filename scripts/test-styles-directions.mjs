import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { briefSchema } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate, directionPlans } from '../src/lib/engine/generate.ts'
import { varyExterior } from '../src/lib/engine/variation.ts'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { styleFamilyPool } from '../src/lib/engine/facade/architecturalFamilies.ts'
import { ARCHITECTURAL_FEATURE_TYPES } from '../src/lib/engine/facade/proceduralTypes.ts'
import { validate } from '../src/lib/rules/index.ts'
import { rectUnionArea } from '../src/lib/geometry.ts'
import { DEFAULT_DIVERSITY_LIMITS } from '../src/lib/engine/fingerprint/VillaDiversityGate.ts'

/* Styles that look like themselves, four directions on four plans, and a
 * large villa that holds its whole site. */

const plan = (patch) => generate(compile(briefSchema.parse(patch)))
const PLOT = { plotWidth: 18, plotDepth: 24 }

test('a courtyard house has a real courtyard; a contemporary house steps or wings', () => {
  for (const site of [PLOT, { plotWidth: 30, plotDepth: 40 }]) {
    const court = plan({ style: { character: 'courtyard-indian' }, site })
    assert.equal(court.massingType, 'courtyard')
    assert.ok(court.floors[0].courtyard, 'the court is part of the ground floor')
    assert.ok(validate(court).hardChecksPass)
    const contemporary = plan({ style: { character: 'contemporary-indian' }, site })
    assert.ok(['stepped', 'l-shape', 'courtyard'].includes(contemporary.massingType), contemporary.massingType)
  }
})

test('every exterior keeps to its own style, never borrowing another style\'s look', () => {
  for (const character of ['modern-box', 'contemporary-indian', 'courtyard-indian']) {
    const base = plan({ style: { character }, site: PLOT })
    const pool = styleFamilyPool(character)
    for (let i = 1; i <= 16; i++) {
      const seed = i * 7919
      const family = generateAlternativeDesign(varyExterior(base, seed), seed).facadeGrammar.architecturalFamily
      assert.ok(pool.includes(family), `${character} seed ${seed}: ${family}`)
    }
  }
})

test('the precedent elements appear in their styles', () => {
  const seen = (character) => {
    const base = plan({ style: { character }, site: PLOT })
    return new Set(Array.from({ length: 24 }, (_, i) => (i + 1) * 7919).flatMap((seed) =>
      generateAlternativeDesign(varyExterior(base, seed), seed).facadeGrammar.features.map((f) => f.type)))
  }
  const court = seen('courtyard-indian')
  assert.ok(court.has('COLONNADE') && court.has('FREEFORM_CANOPY'), [...court].join())
  const contemporary = seen('contemporary-indian')
  assert.ok(contemporary.has('TIMBER_BATTEN') && contemporary.has('FREEFORM_CANOPY'), [...contemporary].join())
})

test('Blender has a mesh recipe for every architectural feature type', () => {
  const builder = readFileSync(new URL('../blender/facade/features.py', import.meta.url), 'utf8')
  for (const type of ARCHITECTURAL_FEATURE_TYPES) assert.ok(builder.includes(`"${type}"`), type)
})

test('directions explore a different plan shape each where the plot allows', () => {
  const model = compile(briefSchema.parse({ style: { character: 'contemporary-indian' }, site: PLOT }))
  const wants = directionPlans(model)
  assert.equal(wants.length, 4)
  assert.equal(new Set(wants.map((w) => w.family)).size, 4)
  assert.deepEqual(directionPlans(model), wants, 'deterministic')
  const court = directionPlans(compile(briefSchema.parse({ style: { character: 'courtyard-indian' }, site: PLOT })))
  assert.ok(court.every((w) => ['courtyard', 'l-shape'].includes(w.family)), 'a courtyard house explores only its own shapes')
})

test('a large villa grows into its plot and the whole site is planned; a villa is unchanged', () => {
  for (const site of [PLOT, { plotWidth: 30, plotDepth: 40 }]) {
    const m = compile(briefSchema.parse({ project: { buildingType: 'large-villa' }, site }))
    const d = generate(m)
    assert.ok(validate(d).hardChecksPass)
    const env = { x: m.setbacksMm.W, y: m.setbacksMm.N, w: m.envelope.width, h: m.envelope.depth }
    const clip = (r) => {
      const x = Math.max(r.x, env.x), y = Math.max(r.y, env.y)
      const w = Math.min(r.x + r.w, env.x + env.w) - x, h = Math.min(r.y + r.h, env.y + env.h) - y
      return w > 0 && h > 0 ? [{ x, y, w, h }] : []
    }
    const planned = rectUnionArea([...d.floors[0].rooms.map((r) => r.rect), ...d.siteFeatures.map((f) => f.rect)].flatMap(clip))
    assert.ok(planned >= 0.95 * env.w * env.h, `${planned / (env.w * env.h)} of the buildable area is planned`)
    assert.ok(d.coverage <= 0.6, 'never over the coverage limit')
    const villa = generate(compile(briefSchema.parse({ site })))
    assert.ok(d.footprintSqm > 1.4 * villa.footprintSqm, `${d.footprintSqm} vs ${villa.footprintSqm}`)
  }
})

test('choosing a direction replays exactly its own plan and exterior', async () => {
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) return { url: new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, shortCircuit: true }
    return nextResolve(specifier, context)
  } })
  const storage = new Map()
  globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) }
  globalThis.window = { localStorage: globalThis.localStorage }
  mock.method(console, 'debug', () => {})
  const { useStudio } = await import('../src/state/studio.ts')
  useStudio.setState({ brief: briefSchema.parse({ style: { character: 'courtyard-indian' }, site: PLOT }), directions: null,
    pinned: null, result: null, referencePreferences: null, recentExteriorSeeds: [], recentVillaFingerprints: [],
    diversityLimits: { ...DEFAULT_DIVERSITY_LIMITS }, shapeDebug: [], generationNotice: null })
  const dirs = useStudio.getState().explore()
  assert.equal(dirs.length, 4)
  assert.ok(new Set(dirs.map((d) => d.buildingModel.planId)).size >= 2, 'the directions stand on different plans')
  assert.ok(new Set(dirs.map((d) => d.facadeModel.architecturalFamily)).size >= 3,
    `the directions lead with different compositions: ${dirs.map((d) => d.facadeModel.architecturalFamily)}`)
  assert.ok(dirs.every((d) => styleFamilyPool('courtyard-indian').includes(d.facadeModel.architecturalFamily)))
  for (const d of dirs) {
    const r = useStudio.getState().pin({ massing: d.massing, seed: d.seed, ...(d.planSeed !== undefined ? { planSeed: d.planSeed } : {}) })
    assert.equal(r.buildingModel.planId, d.buildingModel.planId)
    assert.deepEqual(r.facadeModel.features.map((f) => f.type), d.facadeModel.features.map((f) => f.type))
  }
})

import { assessShape, SHAPE_CHOICES } from '../src/lib/engine/planner/fit.ts'

test('each offered shape is checked by really building it; a chosen shape is kept on Directions', () => {
  assert.deepEqual([...SHAPE_CHOICES], ['twin-wing', 'u-wing', 'courtyard-ring', 'pavilion'])
  for (const site of [{}, PLOT]) {
    for (const shape of SHAPE_CHOICES) {
      const check = assessShape(briefSchema.parse({ site }), shape)
      const built = plan({ site, style: { massing: shape } })
      assert.equal(check.ok, validate(built).hardChecksPass && built.massingType === shape, `${JSON.stringify(site)} ${shape}: ${check.reason}`)
    }
  }
  assert.equal(assessShape(briefSchema.parse({}), 'courtyard-ring').ok, false, 'the small default plot cannot take a courtyard ring')
  const chosen = directionPlans(compile(briefSchema.parse({ site: PLOT, style: { massing: 'l-shape' } })))
  assert.ok(chosen.every((w) => w.family === 'l-shape'))
  assert.equal(new Set(chosen.map((w) => w.seed)).size, 4, 'four plans of the chosen shape')
})
