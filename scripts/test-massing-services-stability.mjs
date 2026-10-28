import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Box3,BoxGeometry,Group,Mesh,MeshStandardMaterial} from 'three'
import {defaultBrief,geometryBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {createVillaDesignDNA} from '../src/lib/engine/villaDesignDNA.ts'
import {extractLayout,applyLayout} from '../src/lib/plan/layout.ts'
import {parseLayout} from '../src/lib/plan/parse.ts'
import {finishSignature} from '../src/lib/cost/finishAssignments.ts'
import {SHADE_CONTROL,shadeAnchors,createShadeOverlay} from '../src/lib/three/shadeVariants.ts'
import {concealedWaterPath} from '../src/lib/water/supplyContinuity.ts'
import {concealedFixtureWaste} from '../src/lib/water/fixtureDrainage.ts'

test('a layout edit and save/reload retain the accepted exterior namespace and palette',()=>{
 const brief=defaultBrief();brief.site.plotWidth=22;brief.site.plotDepth=28
 const design=generate(compile(brief),{seed:41}),before=createBuildingModel(design),layout=extractLayout(design)
 layout.exteriorSeed=3063;layout.floors[0].rooms[0].name+=' edited'
 const restored=parseLayout(JSON.parse(JSON.stringify(layout))),after=createBuildingModel(applyLayout(design,restored))
 assert.equal(restored.exteriorSeed,3063);assert.deepEqual(restored.exteriorIdentity,layout.exteriorIdentity)
 assert.notEqual(after.planId,before.planId);assert.equal(after.compositionId,before.compositionId)
 assert.equal(after.exteriorSeedPlanId,before.planId)
 const a=createVillaDesignDNA(before,3063,brief.style.character),b=createVillaDesignDNA(after,3063,brief.style.character)
 assert.equal(b.materialPalette,a.materialPalette);assert.equal(b.massingFamily,a.massingFamily);assert.equal(b.compositionType,a.compositionType)
 const old={...layout};delete old.exteriorIdentity;delete old.exteriorSeed
 assert.ok(parseLayout(old),'older records remain readable')
})

test('pipe sizes and shade selection do not invalidate architectural finishes or seeds',()=>{
 const b=defaultBrief(),signature=finishSignature(b),geometry=JSON.stringify(geometryBrief(b))
 b.specs={overrides:{'water-pipe-size':'mm25','soil-pipe-size':'mm160',[SHADE_CONTROL]:'sand'}}
 assert.equal(finishSignature(b),signature);assert.equal(JSON.stringify(geometryBrief(b)),geometry)
})

test('concealed corners use both wall centre planes; oversized pipes and pinned junctions are not moved',()=>{
 const walls=[{a:{x:0,y:0},b:{x:0,y:2000},thickness:200},{a:{x:0,y:2000},b:{x:2000,y:2000},thickness:200}]
 const floor={floor:{walls,columns:[]}},points=[{x:120,y:500,z:600},{x:120,y:1950,z:600},{x:1800,y:1950,z:600}]
 const before=JSON.stringify(points),result=concealedWaterPath(points,floor,25)
 assert.equal(result[0].x,0);assert.ok(result.some(p=>p.x===0&&p.y===2000));assert.equal(result.at(-1).y,2000)
 assert.deepEqual(concealedWaterPath(points,floor,180),points)
 const fixed=concealedWaterPath(points,floor,25,true);assert.deepEqual(fixed[0],points[0]);assert.deepEqual(fixed.at(-1),points.at(-1))
 assert.equal(JSON.stringify(points),before)
})

test('fixture drops meet the actual wall and the unchanged source branch, not a hardcoded X offset',()=>{
 const f={kind:'washbasin',floorId:'GF',roomId:'bath',point:{x:1500,y:350,z:0},widthMm:600,depthMm:600,branch:{diameterMm:50,points:[{x:1500,y:350,z:-75}]}}
 const building={rooms:[{id:'bath',floorId:'GF',rect:{x:0,y:0,w:3000,h:3000}}],walls:[{floorId:'GF',a:{x:0,y:0},b:{x:3000,y:0},thickness:150}],columns:[]}
 const points=concealedFixtureWaste(f,building)
 assert.ok(points.some((p,i)=>i&&p.y===0&&points[i-1].y===0&&p.z!==points[i-1].z))
 assert.deepEqual(points.at(-1),f.branch.points[0]);assert.ok(points.every(p=>p.x===1500))
})

test('pack shade skins cover only tagged framed balconies without changing the source model',()=>{
 const source=new Group(),material=new MeshStandardMaterial({color:'#eeeecc'}),slab=new Mesh(new BoxGeometry(5,.2,2),material),beam=new Mesh(new BoxGeometry(5,.1,2),material)
 slab.name='FF_Balcony_balcony1_Slab';slab.userData.source_id='FF:balcony1';slab.position.y=3
 beam.name='Grammar_Beam_01';beam.position.y=5.8;beam.userData={grammar_category:'BALCONY',source_anchor_id:'FF:balcony1'};source.add(slab,beam)
 const asset=new Group();asset.add(new Mesh(new BoxGeometry(1,.2,.5),material))
 const vertices=slab.geometry.attributes.position.array.slice(),color=material.color.getHexString()
 assert.equal(shadeAnchors(source).length,1)
 const overlay=createShadeOverlay(source,asset,'terracotta'),box=new Box3().setFromObject(overlay.root),floor=new Box3().setFromObject(slab)
 for(const edge of ['min','max'])for(const axis of ['x','z'])assert.ok(Math.abs(box[edge][axis]-floor[edge][axis])<1e-8)
 assert.ok(overlay.root.children.length>=2);assert.equal(material.color.getHexString(),color);assert.deepEqual(slab.geometry.attributes.position.array,vertices)
 overlay.dispose();delete beam.userData.source_anchor_id;assert.equal(shadeAnchors(source).length,0)
 for(const name of ['detail-awning','detail-awning-wide']){const glb=readFileSync(new URL(`../public/exterior-assets/kenney-shades/${name}.glb`,import.meta.url));assert.equal(glb.toString('ascii',0,4),'glTF');const json=JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)));assert.ok(json.images.every(i=>i.bufferView!==undefined),'textures are local, not remote hotlinks')}
})
