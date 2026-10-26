import test from 'node:test'
import assert from 'node:assert/strict'
import {Mesh,Group,BoxGeometry,MeshStandardMaterial,MeshPhysicalMaterial} from 'three'
import {refineKitchenSlabs} from '../src/lib/interior/kitchenSlabs.ts'
import {furnishSingleRoom} from '../src/lib/three/buildDollhouse.ts'
import {applyWalkthroughMaterialBindings} from '../src/lib/three/loadWalkthroughAsset.ts'
import {adaptWalkthroughResolution,WALKTHROUGH_QUALITY} from '../src/lib/walkthrough/quality.ts'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createWalkthroughSource} from '../src/lib/walkthrough/source.ts'
import {buildWalkthroughScene} from '../src/lib/walkthrough/scene.ts'
import {prepareWalkthroughGeometry,prepareWalkthroughAppearance} from '../src/lib/walkthrough/delivery.ts'

test('joined slabs remove corner overlap without filling a sink cut-out or changing selected material',()=>{
 const look={color:'#ab9988',rough:.2,surface:{pattern:'large',tileM:1.2}}
 const slab=(id,x,z,w,d)=>({id,pos:[x,.88,z],size:[w,.04,d],look})
 const original=[slab('k-top0',1,0,2,.6),slab('k-top1',1.7,.7,.6,2)]
 const result=refineKitchenSlabs(original,original.map(b=>b.id)),area=result.reduce((n,b)=>n+b.size[0]*b.size[2],0)
 assert.ok(Math.abs(area-(2*.6+.6*2-.6*.6))<1e-8)
 for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++){
  const a=result[i],b=result[j];assert.ok(Math.abs(a.pos[0]-b.pos[0])>=(a.size[0]+b.size[0])/2-1e-7||Math.abs(a.pos[2]-b.pos[2])>=(a.size[2]+b.size[2])/2-1e-7)
 }
 const strips=[slab('k-top0-left',-.6,0,.8,.6),slab('k-top0-right',.6,0,.8,.6),slab('k-top0-near',0,-.25,.4,.1),slab('k-top0-far',0,.25,.4,.1)]
 const cut=refineKitchenSlabs(strips,['k-top0'])
 assert.ok(cut.every(b=>b.look.finish==='worktop'&&b.look.color===look.color&&b.size[1]===.04&&b.bevel===.0015))
 assert.ok(cut.every(b=>Math.abs(b.pos[0])>=b.size[0]/2||Math.abs(b.pos[2])>=b.size[2]/2),'sink centre remains open')
 assert.deepEqual(original.map(b=>b.look),[look,look],'inputs are immutable')
})

test('compact kitchen gets a slab and sink without occupying its real columns or door thresholds',()=>{
 const room={id:'kitchen',name:'Kitchen',rect:{x:14600,y:2000,w:2400,h:3300}}
 const columns=[{id:'C1',at:{x:17000,y:2000},size:300},{id:'C2',at:{x:17000,y:5300},size:350}]
 const openings=[{id:'slide',kind:'door',width:1800,leaf:false,treatment:'glazed-slide',orient:'v',at:{x:14600,y:3650},rooms:['kitchen','dining']},{id:'door',kind:'door',width:800,leaf:true,orient:'h',at:{x:15250,y:5300},rooms:['kitchen','corridor']},{id:'window',kind:'window',width:1200,orient:'h',sill:1050,at:{x:15800,y:2000},rooms:['kitchen',null]}]
 const floor={level:0,rooms:[room],openings,columns,structuralSizing:{columns}},plan={floors:[floor]}
 const before=structuredClone(plan),parts=furnishSingleRoom(plan,0,'kitchen',2.9)
 assert.ok(parts.some(p=>p.id==='kitchen-top0'));assert.ok(parts.some(p=>p.id==='kitchen-sink'))
 const slab=parts.find(p=>p.id==='kitchen-top0')
 for(const c of columns){const x=(c.at.x-15800)/1000,z=(c.at.y-3650)/1000;assert.ok(Math.abs(slab.pos[0]-x)>=(slab.size[0]+c.size/1000)/2||Math.abs(slab.pos[2]-z)>=(slab.size[2]+c.size/1000)/2,'column remains clear')}
 assert.deepEqual(plan,before,'house architecture is untouched')
})

test('cabinet models leave slab/sink parts independent and selected stone edits retain architecture and furniture positions',()=>{
 const brief=defaultBrief();brief.site.plotWidth=25;brief.site.plotDepth=30
 const plan=generate(compile(brief),{seed:41}),prefs={style:'modern',lighting:'daylight',furnitureDensity:'medium'}
 const prepare=d=>{const s=createWalkthroughSource(d,{hardChecksPass:true},prefs),g=prepareWalkthroughGeometry(buildWalkthroughScene(s.building,{hardChecksPass:true}));return {g,s,app:prepareWalkthroughAppearance(d,s,g)}}
 const before=prepare(plan),slabs=before.app.furniture.filter(p=>before.app.bindings[p.binding]?.finish==='worktop')
 assert.ok(slabs.length)
 for(const model of before.app.models.filter(m=>/kitchen-(base|drawers|upper)/.test(m.assetId)))assert.ok(model.replaces.every(id=>!slabs.some(s=>s.id===id)&&!id.includes('sink-')))
 const next=structuredClone(plan);next.model.brief.specs.overrides['kitchen-counter']='granite'
 const after=prepare(next)
 assert.equal(before.s.geometryKey,after.s.geometryKey);assert.deepEqual(before.g,after.g)
 assert.deepEqual(slabs,after.app.furniture.filter(p=>after.app.bindings[p.binding]?.finish==='worktop'))
 assert.ok(slabs.some(p=>JSON.stringify(before.app.bindings[p.binding])!==JSON.stringify(after.app.bindings[p.binding])))
 for(const p of before.app.furniture.filter(p=>!slabs.some(s=>s.id===p.id)))assert.deepEqual(p,after.app.furniture.find(a=>a.id===p.id))
})

test('stone shader adds only subtle surface detail, keeping selected colour and existing geometry',async()=>{
 const root=new Group(),geometry=new BoxGeometry(2,.04,.6),mesh=new Mesh(geometry,new MeshStandardMaterial());mesh.userData.materialBinding='counter';root.add(mesh)
 await applyWalkthroughMaterialBindings(root,{counter:{color:'#332a22',rough:.2,finish:'worktop'}})
 assert.ok(mesh.material instanceof MeshPhysicalMaterial);assert.equal(mesh.material.color.getHexString(),'332a22');assert.equal(mesh.geometry,geometry)
 assert.equal(mesh.material.clearcoat,.25);assert.equal(mesh.material.bumpScale,.00008)
 assert.ok(mesh.material.bumpMap.image.width<=128)
})

test('60 FPS mode reduces resolution under load, stays bounded and waits before recovering quality',()=>{
 assert.equal(WALKTHROUGH_QUALITY.adaptive.target,60)
 assert.ok(adaptWalkthroughResolution('adaptive',50,1,2).ratio<1)
 assert.equal(adaptWalkthroughResolution('performance',20,.65,0).ratio,.65)
 assert.equal(adaptWalkthroughResolution('adaptive',60,1,0).ratio,1)
 assert.ok(adaptWalkthroughResolution('detailed',60,1,3).ratio>1)
 assert.equal(adaptWalkthroughResolution('detailed',120,1.25,3).ratio,1.25)
 assert.equal(adaptWalkthroughResolution('adaptive',58,1,0).ratio,1)
})
