import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief,geometryBrief,parseStoredBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {plinthEnclosure} from '../src/lib/three/plinthEnclosure.ts'
import {EXTERIOR_PALETTES} from '../src/lib/model/exteriorPalette.ts'
import {automaticFacadeDesign} from '../src/lib/model/facadeDesign.ts'
import {entryRamp as createEntryRamp} from '../src/lib/engine/entryRamp.ts'
import {Group,Mesh,BoxGeometry,MeshStandardMaterial} from 'three'
import {prepareVillaScene} from '../src/lib/three/prepareVillaScene.ts'
import {registerHooks} from 'node:module'
registerHooks({resolve(s,c,next){return s.startsWith('@/')?{url:new URL(`../src/${s.slice(2)}`,import.meta.url).href,shortCircuit:true}:next(s,c)}})
const {computeDirections}=await import('../src/state/studio.ts')
import {DEFAULT_DIVERSITY_LIMITS} from '../src/lib/engine/fingerprint/VillaDiversityGate.ts'

test('zero elevation retains buried foundations and omits raised plinth infill',()=>{
 const brief=defaultBrief();brief.specs.overrides['plinth-height']='ground'
 const plan=generate(compile(brief)),building=createBuildingModel(plan)
 assert.equal(building.structuralSizing.plinthHeightMm,0)
 assert.ok(building.structuralSizing.footings.every(f=>f.bottomMm<0))
 assert.equal(plinthEnclosure(building),null)
 brief.entry.ramp=true;assert.equal(createEntryRamp(plan),null)
 assert.ok(parseStoredBrief(JSON.parse(JSON.stringify(brief))).success)
})
test('live palettes recolour exterior material roles without modifying source geometry or colours',()=>{
 const source=new Group()
 for(const [i,role] of ['primary_wall','secondary_wall','accent'].entries()){
  const mesh=new Mesh(new BoxGeometry(1,2,1),new MeshStandardMaterial({color:'#ffffff'}));mesh.position.x=i*3;mesh.userData.material_role=role;source.add(mesh)
 }
 const original=source.children.map(m=>[m.geometry,m.material.color.getHex()])
 for(const p of EXTERIOR_PALETTES){const view=prepareVillaScene(source,4,false,false,false,false,p.id),colours=[];view.traverse(o=>{if(o instanceof Mesh)colours.push(o.material.color.getHexString())})
  assert.deepEqual(new Set(colours),new Set(p.colours.map(c=>c.slice(1).toLowerCase())))
 }
 source.children.forEach((m,i)=>{assert.equal(m.geometry,original[i][0]);assert.equal(m.material.color.getHex(),original[i][1])})
})
test('all four exterior combinations persist without entering the plan seed',()=>{
 const base=defaultBrief()
 for(const p of EXTERIOR_PALETTES){const brief=structuredClone(base);brief.facadeDesign={...automaticFacadeDesign(42),exteriorPalette:p.id}
  assert.deepEqual(geometryBrief(brief),geometryBrief(base));assert.equal(parseStoredBrief(brief).data.facadeDesign.exteriorPalette,p.id)
 }
})
test('four generated directions carry four distinct saved exterior palettes',()=>{
 const brief=defaultBrief();brief.site.plotWidth=25;brief.site.plotDepth=30
 const out=computeDirections({brief,pinned:null,referencePreferences:null,recentVillaFingerprints:[],diversityLimits:DEFAULT_DIVERSITY_LIMITS})
 assert.equal(out.dirs.length,4)
 assert.equal(new Set(out.dirs.map(d=>d.design.model.brief.facadeDesign.exteriorPalette)).size,4)
})
