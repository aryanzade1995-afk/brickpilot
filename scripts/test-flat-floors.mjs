import test from 'node:test'
import assert from 'node:assert/strict'
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, BufferGeometry, Float32BufferAttribute } from 'three'
import { separateCoplanar } from '../src/lib/three/separateCoplanar.ts'
import { applyWalkthroughMaterialBindings } from '../src/lib/three/loadWalkthroughAsset.ts'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { paintColour, applyPaintColour } from '../src/lib/finishes/paint.ts'
import { gpuLabel, WALKTHROUGH_QUALITY } from '../src/lib/walkthrough/quality.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseAcceptedVilla } from '../src/lib/three/acceptedVillaWalkthrough.ts'
import { Vector3 } from 'three'

test('floor buffers stay exact under coplanar cleanup; unrelated overlaps do not accumulate offsets', () => {
  const root=new Group(), floors=[]
  for(let i=0;i<35;i++) {
    const floor=new Mesh(new BoxGeometry(2,.125,2),new MeshStandardMaterial());floor.name=`FF_Terrace_Deck_${i}`;floor.position.set(i*4,6.1375,0);root.add(floor);floors.push(floor)
    for(let j=0;j<2;j++) {const trim=new Mesh(new BoxGeometry(.2,.2,1),new MeshStandardMaterial());trim.name=`trim_${i}_${j}`;trim.position.set(i*4,6.1,0);root.add(trim)}
  }
  const before=floors.map(m=>[...m.geometry.attributes.position.array])
  const done=separateCoplanar(root);assert.ok(done.meshes>0)
  floors.forEach((m,i)=>assert.deepEqual([...m.geometry.attributes.position.array],before[i]))
  root.children.filter(m=>m.name.startsWith('trim')).forEach(m=>{const p=m.geometry.attributes.position;assert.ok(Math.abs(p.getY(0))<=.104501)})
  const snapshots=root.children.map(m=>[...m.geometry.attributes.position.array]);assert.equal(separateCoplanar(root).meshes,0)
  root.children.forEach((m,i)=>assert.deepEqual([...m.geometry.attributes.position.array],snapshots[i]))
})

test('adjacent triangle bounding boxes are not mistaken for actual surface overlap', () => {
  const root=new Group()
  for(const points of [[0,0,0,2,0,0,0,2,0],[2,0,0,2,2,0,0,2,0]]) {
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(points,3));g.computeVertexNormals();root.add(new Mesh(g,new MeshStandardMaterial()))
  }
  assert.equal(separateCoplanar(root).meshes,0)
})

test('selected room floor gets correctly scaled finish shading without changed geometry, colour or neighbouring rooms', async () => {
  const root=new Group(), key=r=>JSON.stringify(['GF',r,'floor']), floor=new Mesh(new BoxGeometry(4,.125,3),new MeshStandardMaterial()), other=new Mesh(new BoxGeometry(3,.125,3),new MeshStandardMaterial())
  floor.userData.materialBinding=key('living');other.userData.materialBinding=key('bed');root.add(floor,other)
  const before=[...floor.geometry.attributes.position.array], bindings={
    [key('living')]:{color:'#987654',rough:.25,surface:{pattern:'tile',tileM:.8,tileSizeM:[.8,1.6]}},
    [key('bed')]:{color:'#665544',rough:.45,surface:{pattern:'plank',tileM:1.2,tileSizeM:[1.2,.2]}}
  }
  await applyWalkthroughMaterialBindings(root,bindings)
  assert.equal(floor.material.color.getHexString(),'987654');assert.equal(floor.material.roughness,.25)
  assert.deepEqual(floor.material.bumpMap.repeat.toArray(),[1.25,.625]);assert.equal(floor.material.bumpScale,.0006)
  const neighbour=other.material
  await applyWalkthroughMaterialBindings(root,{...bindings,[key('living')]:{...bindings[key('living')],color:'#224466'}})
  assert.equal(other.material,neighbour);assert.deepEqual([...floor.geometry.attributes.position.array],before)
  assert.equal(floor.material.color.getHexString(),'224466');assert.ok(floor.material.bumpMap)
})

test('coordinated default room paints share one resolver and never overwrite explicit whole-home or room choices', () => {
  const brief=defaultBrief(), before=JSON.stringify(brief)
  const rooms=['0:GF_LIVING','0:GF_DINING','0:GF_KITCHEN','1:FF_MASTER_BED','1:FF_STUDY']
  assert.equal(new Set(rooms.map(r=>paintColour(brief,r).hex)).size,5)
  assert.ok(rooms.every(r=>paintColour(brief,r).label.endsWith('(default)')))
  assert.equal(JSON.stringify(brief),before)
  const whole=applyPaintColour(brief,'#123456',rooms,rooms)
  assert.ok(rooms.every(r=>paintColour(whole,r).hex==='#123456'))
  const scoped=applyPaintColour(whole,'#AABBCC',rooms,[rooms[2]])
  assert.equal(paintColour(scoped,rooms[2]).hex,'#AABBCC');assert.equal(paintColour(scoped,rooms[3]).hex,'#123456')
})

test('all graphics profiles adapt resolution without changing geometry, and report the actual GPU', () => {
  for(const budget of Object.values(WALKTHROUGH_QUALITY))assert.ok(budget.min<=budget.start && budget.start<=budget.max && budget.max<=1.75)
  assert.match(gpuLabel('ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU (0x0000), D3D11)'),/RTX 3050/)
  assert.match(gpuLabel('ANGLE (Intel, Intel UHD Graphics, D3D11)'),/Intel/)
})

test('rebuilt accepted villa has one continuous flat terrace mesh before and after shared viewer preparation', {skip:!process.env.WALKTHROUGH_VILLA_JOB}, async () => {
  const dir=process.env.WALKTHROUGH_VILLA_JOB, accepted=JSON.parse(await readFile(join(dir,'accepted.json'),'utf8'))
  const input=JSON.parse(await readFile(join(accepted.directory,'input.json'),'utf8')), top=input.buildingModel.floors.toSorted((a,b)=>b.level-a.level)[0]
  const bytes=await readFile(join(accepted.directory,accepted.files.find(f=>f.endsWith('.glb')))), root=await parseAcceptedVilla(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),accepted.planId)
  const decks=[];root.traverse(m=>{if(m.isMesh && /Terrace_Deck/.test(m.name))decks.push(m)})
  assert.equal(decks.length,1);assert.equal(decks[0].userData.level_plate,true)
  root.updateMatrixWorld(true)
  const deck=decks[0], original=[...deck.geometry.attributes.position.array], elevation=(top.elevationMm+top.heightMm)/1000, bottom=elevation-top.slabThicknessMm/1000
  for(const run of [()=>{},()=>separateCoplanar(root)]) {
    run();const p=deck.geometry.attributes.position
    for(let i=0;i<p.count;i++) {const y=new Vector3().fromBufferAttribute(p,i).applyMatrix4(deck.matrixWorld).y;assert.ok(Math.min(Math.abs(y-elevation),Math.abs(y-bottom))<.00001,`No stepped/ridged deck: ${y}`)}
  }
  assert.deepEqual([...deck.geometry.attributes.position.array],original)
})
