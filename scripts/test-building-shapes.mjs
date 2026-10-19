import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { buildingShape, buildingShapeDifference, findNewBuildingShape, parseBuildingShapes, MIN_BUILDING_SHAPE_CHANGE } from '../src/lib/engine/buildingShapes.ts'
import { validate } from '../src/lib/rules/index.ts'

const brief = defaultBrief()
brief.site.plotWidth = 28; brief.site.plotDepth = 32
brief.project.buildingType = 'large-villa'; brief.style.character = 'modern-box'
const plan = generate(compile(brief), { massing: 'twin-wing', seed: 41 })

test('building identity ignores partitions, accessories, seeds, family labels and plot translation', () => {
  const a = structuredClone(plan), b = structuredClone(plan)
  a.floors.forEach(f => { f.footprint = [{x:2000,y:3000,w:8000,h:12000}] })
  b.floors.forEach(f => { f.footprint = [{x:4000,y:6000,w:4000,h:12000},{x:8000,y:6000,w:4000,h:12000}] })
  b.dna.seed = 9876; b.massingType = 'pavilion'
  assert.deepEqual(buildingShape(a).key, buildingShape(b).key)
  assert.equal(buildingShapeDifference(buildingShape(a),buildingShape(b)), 0)
  b.floors[1].footprint[1].h -= 6000
  assert.ok(buildingShapeDifference(buildingShape(a),buildingShape(b)) >= MIN_BUILDING_SHAPE_CHANGE)
})

test('new houses differ in occupied building shape and keep the requested programme', () => {
  let current = plan; const history = [buildingShape(plan)], keys = new Set(history.map(s=>s.key))
  for (const seed of [1955, 52972, 99143]) {
    const next = findNewBuildingShape({ brief, seed, current, history })
    assert.ok(next, `No new shape for seed ${seed}`)
    assert.ok(validate(next.design).hardChecksPass)
    assert.deepEqual(next.design.model.brief, brief)
    assert.equal(next.design.floors.length, plan.floors.length)
    const shape = buildingShape(next.design)
    assert.ok(!keys.has(shape.key))
    for (const previous of history) assert.ok(buildingShapeDifference(previous,shape)>=MIN_BUILDING_SHAPE_CHANGE)
    keys.add(shape.key);history.push(shape);current=next.design
  }
})

test('invalid persisted shape history is repaired', () => {
  assert.deepEqual(parseBuildingShapes([{key:'bad',floors:[[{x:0,y:0,w:-1,h:1}]]},null,{}]),[])
  assert.deepEqual(parseBuildingShapes([buildingShape(plan)]),[buildingShape(plan)])
})

registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier.startsWith('@/') ? { url: new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context)
} })
const storage = new Map()
globalThis.localStorage = {getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}
globalThis.window = {localStorage:globalThis.localStorage}
const { useStudio } = await import('../src/state/studio.ts')
const { useBlender } = await import('../src/state/blender.ts')

test('the shape action updates the 2D source and exact seed together and survives save/reopen', async () => {
  const generateBefore = useBlender.getState().generate
  useBlender.setState({ job:null, generate:async(design,seed)=>{
    const planId=createBuildingModel(design).planId
    useBlender.setState({accepted:{[planId]:{planId,seed}}})
  } })
  try {
  useStudio.getState().loadSaved(brief,{massing:plan.massingType,seed:1955,planSeed:plan.planSeed,planFamily:plan.planFamily,
    recipe:plan.planRecipe,planner:plan.planProposal?'ml':'baseline'})
  const before = useStudio.getState().run()
  assert.equal(await useStudio.getState().newBuildingShape(),true)
  const after = useStudio.getState().result, pin = useStudio.getState().pinned
  assert.equal(pin.formVersion,'site-form-v3')
  assert.ok(buildingShapeDifference(buildingShape(before.design),buildingShape(after.design))>=MIN_BUILDING_SHAPE_CHANGE)
  assert.equal(after.villaDesignDNA.seed,pin.seed)
  const identity = createBuildingModel(after.design)
  useStudio.getState().loadSaved(brief,pin)
  const reopened = useStudio.getState().run()
  assert.deepEqual(createBuildingModel(reopened.design),identity)
  assert.equal(reopened.villaDesignDNA.seed,pin.seed)
  assert.ok(useStudio.getState().recentBuildingShapes.some(s=>s.key===buildingShape(after.design).key))
  } finally { useBlender.setState({generate:generateBefore,job:null}) }
})

test('a failed 3D replacement never replaces the displayed plan, its pin or room edits',async()=>{
  const generateBefore=useBlender.getState().generate
  useBlender.setState({job:null,accepted:{},generate:async()=>{useBlender.setState({error:'Renderer unavailable',job:{status:'failed',debug:[]}})}})
  const before=useStudio.getState(), identity=createBuildingModel(before.result.design)
  try {
    assert.equal(await useStudio.getState().newBuildingShape(),false)
    assert.deepEqual(createBuildingModel(useStudio.getState().result.design),identity)
    assert.deepEqual(useStudio.getState().pinned,before.pinned)
    assert.equal(useStudio.getState().layout,before.layout)
    assert.equal(useStudio.getState().generationNotice,'Renderer unavailable')
  } finally {useBlender.setState({generate:generateBefore,job:null,error:null})}
})

test('applying a composition commits its brief and plan only after the matching render, then reopens exactly',async()=>{
 const generateBefore=useBlender.getState().generate
 const b=defaultBrief();b.site.plotWidth=22;b.site.plotDepth=28
 const original=generate(compile(b),{massing:'twin-wing',seed:41,formVersion:'site-form-v3'})
 useStudio.getState().loadSaved(b,{massing:original.massingType,seed:1955,planSeed:original.planSeed,
  planFamily:original.planFamily,recipe:original.planRecipe,formVersion:original.formVersion,planner:original.planProposal?'ml':'baseline'})
 useStudio.getState().run();useStudio.setState({recentBuildingShapes:[]})
 useBlender.setState({job:null,generate:async(design,seed)=>{
  assert.equal(useStudio.getState().brief.style.composition,undefined,'Brief changed before rendering succeeded')
  assert.equal(design.model.brief.style.composition,'staggered-wings')
  const planId=createBuildingModel(design).planId
  useBlender.setState({accepted:{[planId]:{planId,seed}}})
 }})
 try{
  assert.equal(await useStudio.getState().newBuildingShape('preview','staggered-wings'),true)
  const s=useStudio.getState(),identity=createBuildingModel(s.result.design)
  assert.equal(s.brief.style.composition,'staggered-wings')
  assert.equal(s.result.model.brief.style.composition,'staggered-wings')
  useStudio.getState().loadSaved(s.brief,s.pinned)
  const reopened=useStudio.getState().run(),reopenedModel=createBuildingModel(reopened.design)
  assert.equal(reopenedModel.planId,identity.planId,JSON.stringify({pin:s.pinned,before:identity.orientation,after:reopenedModel.orientation,seed:reopened.design.planSeed,composition:reopened.design.model.brief.style.composition}))
  assert.deepEqual(reopenedModel,identity)
 }finally{useBlender.setState({generate:generateBefore,job:null})}
})
