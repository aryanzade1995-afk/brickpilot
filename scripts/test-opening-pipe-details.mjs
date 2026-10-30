import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {balconySliders,roofAccess} from '../src/lib/walkthrough/openingAssemblies.ts'
import {realizedTerraceObjects} from '../src/lib/solar/terraceObjects.ts'
import {createVillaPlumbing} from '../src/lib/plumbing/villaPlumbing.ts'
import {pipeAssembly} from '../src/lib/plumbing/assembly.ts'
import {createPlumbingGroup,disposePlumbingGroup,PIPE_COLORS} from '../src/lib/plumbing/pipeGeometry.ts'
const rect={x:0,y:0,w:12000,h:10000}
const source={planId:'detail-test',floors:[{id:'FF',level:1,name:'FF',elevationMm:3000,heightMm:3000,slabThicknessMm:150,footprint:[rect]}],rooms:[{id:'stair',floorId:'FF'}],stairs:[{floorId:'FF',startSide:'S',rect:{x:3000,y:2000,w:2400,h:3300}}],shafts:[{id:'shaft',floorId:'FF',roomId:'bath',rect:{x:10000,y:8000,w:600,h:600}}],walls:[],columns:[],beams:[],doors:[],roofTerrace:{slab:[rect],outline:rect,mumty:{x:3000,y:2000,w:2400,h:3300},tank:{x:600,y:600,w:1100,h:1100}}}
const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y
function recordTreads(building){
 const s=building.stairs[0],r=s.rect,horizontal=['N','S'].includes(s.startSide)
 const lo=horizontal?r.x:r.y,size=horizontal?r.w:r.h
 s.treads=[0,1].map(f=>[lo+f*size/2+50,lo+(f+1)*size/2-50].map(at=>horizontal?{x:at,y:r.y+1000}:{x:r.x+1000,y:at}))
 return building
}
recordTreads(source)
test('roof exit reuses the enclosure aperture and preserves source architecture',()=>{
 for(const side of ['N','E','S','W']){
  const b=structuredClone(source);b.stairs[0].startSide=side;recordTreads(b);const before=JSON.stringify(b),r=roofAccess(b),a=r.opening.apertureMm
  assert.equal(JSON.stringify(b),before);assert.equal(r.opening.sourceId,'ROOF_STAIR_EXIT');assert.equal(a.z,6000)
  assert.equal(r.opening.swing,side==='N'||side==='W'?-1:1)
  for(const w of r.walls){const q=w.boundsMm;assert.ok(!(overlaps({x:a.x,y:a.y,w:a.w,h:a.d},{x:q.x,y:q.y,w:q.w,h:q.d})&&q.z<a.z+a.h&&q.z+q.h>a.z))}
  assert.equal(r.cap.z,8200);assert.ok(r.protectedAreaMm.w>=1200&&r.protectedAreaMm.h>=1200)
 }
 assert.equal(roofAccess({...source,stairs:[]}),null)
})
test('balcony hardware preserves the source aperture; narrow doors retain full-clear operation',()=>{
 for(const [width,treatment,operation,clear]of [[1800,'glazed-slide','paired-slide',805],[900,undefined,'surface-slide',790]]){
  const b={...source,rooms:[{id:'balcony1',semanticId:'FF_BAL',floorId:'FF',outdoor:true,rect:{x:0,y:5000,w:6000,h:1800}}],walls:[{id:'wall',floorId:'FF',a:{x:0,y:5000},b:{x:6000,y:5000},thickness:230}],doors:[{id:'balcony',floorId:'FF',at:{x:3000,y:5000},orient:'h',width,treatment,rooms:['FF_BAL',null]}]}
  const before=JSON.stringify(b),[a]=balconySliders(b);assert.equal(a.operation,operation);assert.equal(a.clearWidthMm,clear);assert.equal(JSON.stringify(b),before);assert.ok(a.offsetMm>0)
 }
})
test('roof approach stays clear of terrace furnishings and low water headers',()=>{
 const access=roofAccess(source).protectedAreaMm
 for(const o of realizedTerraceObjects(source))assert.ok(!overlaps(access,o.rectMm),o.id)
 const layout=createVillaPlumbing(source,{waterMm:32,soilMm:110,wasteMm:75})
 assert.ok(layout.pipes.some(p=>p.id==='supply:shaft'))
 for(const p of layout.pipes.filter(p=>p.system==='water'))for(let i=1;i<p.points.length;i++){
  const a=p.points[i-1],b=p.points[i];if(a.z!==6150||b.z!==6150)continue
  const r=p.diameterMm/2
  assert.ok(!overlaps(access,{x:Math.min(a.x,b.x)-r,y:Math.min(a.y,b.y)-r,w:Math.abs(a.x-b.x)+2*r,h:Math.abs(a.y-b.y)+2*r}),p.id)
 }
})
test('deterministic mesh fittings join and trim canonical tubes without rerouting',()=>{
 const segment=(a,b)=>({system:'water',diameterMm:32,from:{x:a[0],y:a[1],z:0},to:{x:b[0],y:b[1],z:0}})
 const lines=[segment([0,0],[1000,0]),segment([1000,0],[1000,1000])],a=pipeAssembly(lines)
 assert.deepEqual(a,pipeAssembly(lines));assert.equal(a.fittings.filter(f=>f.kind==='elbow').length,1)
 assert.equal(a.tubes.reduce((s,e)=>s+Math.hypot(e.to.x-e.from.x,e.to.y-e.from.y,e.to.z-e.from.z),0),1936)
 const tee=pipeAssembly([...lines,segment([1000,0],[2000,0])]);assert.equal(tee.fittings.filter(f=>f.kind==='tee').length,1)
 for(const f of tee.fittings){const [x,y,z]=f.basis;for(const v of [x,y,z])assert.ok(Math.abs(Math.hypot(v.x,v.y,v.z)-1)<1e-9);assert.ok(Math.abs(x.x*z.x+x.y*z.y+x.z*z.z)<1e-9)}
})
test('actual imported CC0 fittings render in neutral materials with at most three batches',()=>{
 const data=JSON.parse(readFileSync(new URL('../src/lib/plumbing/data/polyhaven-fittings.json',import.meta.url)))
 assert.match(data.source,/polyhaven.com/);assert.match(data.license,/CC0/)
 for(const kind of ['elbow','tee','coupler'])assert.ok(data.parts[kind].positions.length>100)
 assert.deepEqual(PIPE_COLORS,{water:'#dedbd0',drain:'#55595a',vent:'#99958c'})
 const root=createPlumbingGroup(createVillaPlumbing(source,{waterMm:32,soilMm:110,wasteMm:75}))
 assert.ok(root.children.length>0&&root.children.length<=3)
 for(const m of root.children)assert.ok([...m.geometry.attributes.position.array].every(Number.isFinite))
 disposePlumbingGroup(root)
})
