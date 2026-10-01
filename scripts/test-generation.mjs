import assert from 'node:assert/strict'
import test from 'node:test'
import { CHARACTER_LABEL, SELECTABLE_CHARACTERS, defaultBrief } from '../src/lib/model/brief.ts'
import { briefSiteIssues, compile } from '../src/lib/model/canonical.ts'
import { generate, generateDirections } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { buildMassing } from '../src/lib/three/buildMassing.ts'
import { chooseNextExterior, fingerprint, noveltyScore, varyExterior } from '../src/lib/engine/variation.ts'
import { validateVillaVariation } from '../src/lib/engine/facade/grammar.ts'
import { parseInspirationPreferences } from '../src/lib/engine/designDna.ts'

const planSignature = (design) => JSON.stringify({
  structure: design.structure,
  floors: design.floors.map((f) => ({
    footprint: f.footprint, rooms: f.rooms, walls: f.walls, openings: f.openings,
    stair: f.stair, columns: f.columns, beams: f.beams, shafts: f.shafts,
  })),
})

test('seeded design identity is repeatable and varies across seeds', () => {
  // a free-varying style: the default 'modern-box' deliberately keeps one look
  const brief = defaultBrief()
  brief.style.character = 'modern-indian'
  const model = compile(brief)
  const first = generate(model, { seed: 123 })
  const again = generate(model, { seed: 123 })
  assert.deepEqual(first, again)
  const variants = Array.from({ length: 12 }, (_, i) => generate(model, { seed: i + 124 }))
  assert.ok(variants.some((design) => design.dna.facade !== first.dna.facade))
  assert.ok(variants.some((design) => design.dna.materialPalette !== first.dna.materialPalette))
})

test('four exterior directions keep the exact same verified plan', () => {
  const brief = defaultBrief()
  brief.site.plotWidth = 18
  brief.site.plotDepth = 24
  const model = compile(brief)
  const directions = generateDirections(model)
  assert.equal(directions.length, 4)
  assert.equal(new Set(directions.map((dir) => dir.massing)).size, 1)
  assert.equal(new Set(directions.map((dir) => JSON.stringify(fingerprint(dir.design.dna)))).size, 4)
  assert.equal(new Set(directions.map((dir) => dir.design.dna.roofGeometry.element)).size, 4)
  for (const dir of directions) {
    assert.ok(validate(dir.design).hardChecksPass)
    assert.ok(dir.novelty > 0)
    assert.deepEqual(varyExterior(generate(model), dir.seed, 'balanced'), dir.design)
    assert.equal(planSignature(dir.design), planSignature(directions[0].design))
  }
})

test('a tight plot offers only the directions that pass every mandatory check', () => {
  const model = compile(defaultBrief())
  const directions = generateDirections(model)
  assert.ok(directions.length >= 1)
  for (const dir of directions) assert.ok(validate(dir.design).hardChecksPass, dir.massing)
  // an L-shape cannot hold this programme on a 12.6 x 7.7 m zone: rejected, not squeezed in
  assert.ok(!validate(generate(model, { massing: 'l-shape', seed: 977 })).hardChecksPass)
})

test('plan openings match the 3D footprint and mismatch is reported', () => {
  const design = generate(compile(defaultBrief()))
  assert.equal(validate(design).findings.filter((finding) => finding.code === 'PLAN_3D_OPENING_MISMATCH').length, 0)
  const massing = buildMassing(design)
  assert.ok(massing.boxes.some((box) => box.kind === 'glass'))
  assert.ok(massing.boxes.some((box) => box.id.includes('CANOPY') || box.id.includes('ENTRY_JAMB')))
  const invalid = structuredClone(design)
  const opening = invalid.floors[0].openings.find((item) => item.kind === 'window')
  assert.ok(opening)
  opening.at.x = -9999
  assert.ok(validate(invalid).findings.some((finding) => finding.code === 'PLAN_3D_OPENING_MISMATCH'))
})

test('110 seeded exterior variants stay valid and retain the same plan', () => {
  const plan = generate(compile(defaultBrief()))
  assert.ok(validate(plan).hardChecksPass)
  const signature = planSignature(plan)
  const geometrySignatures = new Set()
  for (let seed = 1; seed <= 110; seed++) {
    const design = varyExterior(plan, seed)
    assert.equal(planSignature(design), signature, `plan changed at seed ${seed}`)
    assert.ok(validate(design).hardChecksPass, `plan checks failed at seed ${seed}`)
    assert.deepEqual(validateVillaVariation(design).errors, [], `facade collision at seed ${seed}`)
    const massing = buildMassing(design)
    assert.equal(new Set(massing.boxes.map((b) => b.id)).size, massing.boxes.length, `duplicate 3D id at seed ${seed}`)
    for (const element of massing.boxes.filter((box) => box.id.startsWith('sig-')))
      for (const glass of massing.boxes.filter((box) => box.kind === 'glass'))
        assert.ok([0, 1, 2].some((axis) =>
          Math.abs(element.pos[axis] - glass.pos[axis]) >= (element.size[axis] + glass.size[axis]) / 2 - 0.001),
        `${element.id} blocks ${glass.id} at seed ${seed}`)
    for (const box of massing.boxes) {
      assert.ok([...box.pos, ...box.size].every(Number.isFinite), `${box.id} is not finite`)
      assert.ok(box.size.every((n) => n > 0), `${box.id} has nonpositive geometry`)
    }
    const roof = design.floors.at(-1)
    const pergolaPosts = massing.boxes.filter((box) => box.id.startsWith('perg-p'))
    const roofServices = massing.boxes.filter((box) => box.kind === 'mumty' || box.kind === 'tank')
    for (const post of pergolaPosts) {
      const px = post.pos[0] * 1000 + design.model.plot.width / 2
      const py = post.pos[2] * 1000 + design.model.plot.depth / 2
      assert.ok(px >= roof.outline.x && px <= roof.outline.x + roof.outline.w &&
        py >= roof.outline.y && py <= roof.outline.y + roof.outline.h, 'pergola post lacks a supporting roof')
      if (roof.stair) assert.ok(px < roof.stair.rect.x - 50 || px > roof.stair.rect.x + roof.stair.rect.w + 50 ||
        py < roof.stair.rect.y - 50 || py > roof.stair.rect.y + roof.stair.rect.h + 50, 'pergola post crosses stair')
      for (const service of roofServices) {
        const overlapsX = Math.abs(post.pos[0] - service.pos[0]) < (post.size[0] + service.size[0]) / 2
        const overlapsZ = Math.abs(post.pos[2] - service.pos[2]) < (post.size[2] + service.size[2]) / 2
        assert.ok(!overlapsX || !overlapsZ, `${post.id} crosses ${service.id}`)
      }
    }
    // Count actual exterior mesh geometry, excluding IDs, material and color.
    // Raw variation is not acceptance by the stricter VillaShapeFingerprint gate.
    geometrySignatures.add(JSON.stringify(massing.boxes.map(({ kind, pos, size, level, prism }) => ({ kind, pos, size, level, prism }))))
  }
  assert.ok(geometrySignatures.size >= 95, `only ${geometrySignatures.size} distinct exterior geometries`)
  const directions = generateDirections(plan.model)
  for (let i = 0; i < directions.length; i++)
    for (let j = i + 1; j < directions.length; j++)
      assert.ok(noveltyScore(fingerprint(directions[i].design.dna), fingerprint(directions[j].design.dna)) >= 25)
})

test('seeded roof forms change 3D geometry without moving the verified shell', () => {
  const plan = generate(compile(defaultBrief()))
  const shell = (design) => buildMassing(design).boxes
    .filter((box) => ['wall', 'glass', 'partition', 'slab'].includes(box.kind))
    .map(({ id, kind, pos, size, level }) => ({ id, kind, pos, size, level }))
  const expectedShell = shell(plan)
  const roofShapes = new Set()
  const signature = planSignature(plan)
  for (let seed = 1; seed <= 24; seed++) {
    const design = varyExterior(plan, seed)
    assert.equal(planSignature(design), signature)
    assert.deepEqual(shell(design), expectedShell, `shell moved at seed ${seed}`)
    assert.ok(validate(design).hardChecksPass)
    roofShapes.add(JSON.stringify(buildMassing(design).boxes
      .filter((box) => ['roof', 'prism', 'parapet'].includes(box.kind) && box.level === design.floors.at(-1).level)
      .map(({ kind, pos, size, prism }) => ({ kind, pos, size, prism }))))
  }
  assert.ok(roofShapes.size >= 3, `only ${roofShapes.size} distinct roof geometries`)
})

test('50 Generate Again selections favour new architectural fingerprints', () => {
  const plan = generate(compile(defaultBrief()))
  const history = []
  const prints = new Set()
  let lastElement = null
  for (let i = 0; i < 50; i++) {
    const next = chooseNextExterior(plan, history, 'balanced')
    assert.ok(validate(next).hardChecksPass)
    const element = next.dna.roofGeometry.element
    assert.notEqual(element, lastElement, `roof element repeated at selection ${i}`)
    assert.ok(!buildMassing(next).boxes.some(box=>box.id.startsWith('sig-')), 'roof is free of signature decorations')
    const print = JSON.stringify(fingerprint(next.dna))
    assert.ok(!prints.has(print), `near-repeat at selection ${i}`)
    prints.add(print)
    history.push(next.dna.seed)
    lastElement = element
  }
})

test('subtle rerolls preserve composition while changing detailing', () => {
  const brief = defaultBrief()
  brief.style.diversity = 'low'
  const plan = generate(compile(brief))
  const a = varyExterior(plan, 500, 'subtle')
  const b = varyExterior(plan, 501, 'subtle')
  assert.equal(planSignature(a), planSignature(b))
  for (const trait of ['styleFamily', 'facadeComposition', 'entranceDesign', 'featureElement', 'balconyDesign', 'roofDesign'])
    assert.equal(a.dna[trait], b.dna[trait], trait)
  assert.ok(a.dna.frameThicknessMm !== b.dna.frameThicknessMm ||
    a.dna.materialPalette !== b.dna.materialPalette || a.dna.windowTreatment !== b.dna.windowTreatment)
  const directions = generateDirections(compile(brief))
  assert.ok(directions.length > 0 && directions.length <= 4)
  // Material-only alternatives no longer fill a fourth direction.
  for (let i = 0; i < directions.length; i++) for (let j = i + 1; j < directions.length; j++)
    assert.ok(noveltyScore(fingerprint(directions[i].design.dna), fingerprint(directions[j].design.dna)) >= 3)
})

test('exterior roof DNA matches the roof geometry and window surrounds clear the glass', () => {
  const plan = generate(compile(defaultBrief()))
  for (let seed = 1; seed <= 40; seed++) {
    const design = varyExterior(plan, seed)
    const roof = design.floors.at(-1).roof.kind
    assert.equal(['hip', 'gable', 'mono-slope'].includes(roof),
      ['hip', 'gable', 'mono-slope', 'kerala-pitched'].includes(design.dna.roofDesign))
    const boxes = buildMassing(design).boxes
    for (const surround of boxes.filter((box) => /-sur\d+[tblr]$/.test(box.id))) {
      const prefix = surround.id.replace(/-sur(\d+)[tblr]$/, '-gl$1')
      const glass = boxes.find((box) => box.id === prefix)
      assert.ok(glass, surround.id)
      const intersection = [0, 1, 2].map((axis) =>
        Math.min(surround.pos[axis] + surround.size[axis] / 2, glass.pos[axis] + glass.size[axis] / 2) -
        Math.max(surround.pos[axis] - surround.size[axis] / 2, glass.pos[axis] - glass.size[axis] / 2))
      assert.ok(intersection.some((extent) => extent <= 0.001), `${surround.id} covers glass`)
    }
  }
})

test('reference cues guide details without changing the chosen style or plan', () => {
  const brief = defaultBrief()
  brief.style.character = 'courtyard-indian'
  const model = compile(brief)
  const normal = generateDirections(model)
  const preferences = parseInspirationPreferences({
    styleFamily: 'tropical-modern', featureElement: 'timber-fins',
    materialPalette: 'tropical-cream', landscapeMood: 'lush-tropical',
    irrelevant: 'discarded',
  })
  assert.ok(preferences)
  assert.equal('irrelevant' in preferences, false)
  const inspired = generateDirections(model, preferences)
  assert.equal(inspired.length, 4)
  for (const direction of inspired) {
    assert.equal(direction.design.dna.styleFamily, 'courtyard-modern')
    assert.equal(direction.design.dna.landscapeMood, 'lush-tropical')
    assert.equal(planSignature(direction.design), planSignature(normal[0].design))
    assert.ok(validate(direction.design).hardChecksPass)
  }
  assert.equal(parseInspirationPreferences({ styleFamily: 'invented-style' }), null)
})

test('new 3D designs stay in the three chosen styles, even with bold variation and a reference', () => {
  assert.deepEqual([...SELECTABLE_CHARACTERS], ['modern-box', 'contemporary-indian', 'courtyard-indian'])
  const families = { 'modern-box': 'modern-box', 'contemporary-indian': 'contemporary-indian',
    'courtyard-indian': 'courtyard-modern' }
  const reference = parseInspirationPreferences({ styleFamily: 'tropical-modern', materialPalette: 'tropical-cream' })
  for (const character of SELECTABLE_CHARACTERS) {
    const brief = defaultBrief()
    brief.style.character = character
    const plan = generate(compile(brief))
    for (let seed = 1; seed <= 8; seed++)
      assert.equal(varyExterior(plan, seed, 'bold', reference).dna.styleFamily, families[character])
  }
})

test('sampled styles and seeds keep every exterior opening on a real wall', () => {
  for (const character of Object.keys(CHARACTER_LABEL)) {
    for (let variation = 0; variation < 8; variation++) {
      const brief = defaultBrief()
      brief.style.character = character
      brief.variation = variation
      const design = generate(compile(brief))
      const mismatches = validate(design).findings.filter((finding) => finding.code === 'PLAN_3D_OPENING_MISMATCH')
      assert.equal(mismatches.length, 0, `${character}, variation ${variation}`)
      if (validate(design).hardChecksPass)
        assert.doesNotThrow(() => buildMassing(design), `${character}, variation ${variation}`)
    }
  }
})

test('every requested room survives on ground-only and multi-storey plans', () => {
  for (const storeys of [0, 2]) {
    const brief = defaultBrief()
    brief.levels.storeys = storeys
    brief.levels.liftProvision = storeys > 0
    brief.spaces.stepFree = true
    brief.rooms.bedroomsWithBath = 3
    brief.rooms.bedroomsNoBath = 2
    brief.rooms.sharedBaths = 3
    brief.rooms.studies = 3
    const model = compile(brief)
    const design = generate(model)
    for (const programme of model.floors) {
      const rooms = design.floors[programme.level].rooms
      for (const required of programme.spaces)
        assert.equal(rooms.filter((room) => room.id === required.id).length, 1,
          `${required.id} on floor ${programme.level}`)
    }
    assert.equal(design.floors.flatMap((floor) => floor.rooms).filter((room) => room.id.startsWith('study')).length, 3)
    assert.equal(design.floors.flatMap((floor) => floor.rooms).filter((room) => room.id.startsWith('sharedBath')).length, 3)
  }
})

test('setbacks and dimensions rotate with the chosen road-facing side', () => {
  const brief = defaultBrief()
  brief.site.plotWidth = 18
  brief.site.plotDepth = 25
  brief.site.facing = 'E'
  brief.site.roadEdges = ['E']
  brief.site.setbacks.E = 4
  brief.site.setbacks.W = 2
  brief.site.setbacks.N = 3
  brief.site.setbacks.S = 1
  const model = compile(brief)
  assert.equal(model.entrySide, 'E')
  assert.deepEqual(model.plot, { width: 25000, depth: 18000 })
  assert.deepEqual(model.setbacksMm, { N: 2000, E: 3000, S: 4000, W: 1000 })
  assert.equal(briefSiteIssues(brief).length, 0)
})

test('invalid geometry and impossible briefs cannot appear as verified directions', () => {
  const brief = defaultBrief()
  brief.site.plotWidth = 6
  brief.site.setbacks.E = 4
  brief.site.setbacks.W = 4
  assert.ok(briefSiteIssues(brief).length)
  assert.deepEqual(generateDirections(compile(brief)), [])

  const design = generate(compile(defaultBrief()))
  design.floors[0].rooms = design.floors[0].rooms.filter((room) => room.id !== 'kitchen')
  assert.ok(validate(design).findings.some((finding) => finding.code === 'PROGRAMME_MISMATCH' && finding.severity === 'error'))
})

test('a requested courtyard is an open room matching the massing void', () => {
  const brief = defaultBrief()
  brief.site.plotWidth = 25
  brief.site.plotDepth = 25
  brief.rooms.priorities.courtyard = true
  const design = generate(compile(brief))
  assert.ok(validate(design).hardChecksPass)
  assert.deepEqual(design.floors[0].rooms.find((room) => room.id === 'courtyard')?.rect,
    design.floors[0].courtyard)
  const massing = buildMassing(design)
  assert.ok(!massing.boxes.some((box) => box.id.includes('courtyard') && box.kind === 'canopy'))
})

test('ground-only lift and step-free bathroom provisions remain in the plan', () => {
  const brief = defaultBrief()
  brief.levels.storeys = 0
  brief.levels.liftProvision = true
  brief.spaces.stepFree = true
  brief.rooms.bedroomsWithBath = 0
  brief.rooms.bedroomsNoBath = 1
  brief.rooms.sharedBaths = 0
  brief.rooms.studies = 0
  const design = generate(compile(brief))
  const ids = new Set(design.floors[0].rooms.map((room) => room.id))
  assert.ok(ids.has('lift'))
  assert.ok(ids.has('accessibleBath'))
  assert.ok(ids.has('bed1'))
})
