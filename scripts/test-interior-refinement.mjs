import test from 'node:test'
import assert from 'node:assert/strict'
import { Box3, Group, Mesh, BoxGeometry, MeshStandardMaterial, InstancedMesh } from 'three'
import { detailedSwitchboard, detailedIndoorPlant, indoorPlantGroups, removeBathroomMirrors } from '../src/lib/three/interiorDetails.ts'
import { disposeWalkthroughAsset } from '../src/lib/three/loadWalkthroughAsset.ts'

test('switch plates preserve mounting coordinates and have real socket apertures on every wall direction', () => {
  for (const normal of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
    const part = { id:'board',roomId:'living',sourceIds:['switchboard'],position:[2,1.2,3],size:normal[0] ? [.018,.1,.16] : [.16,.1,.018],support:{normal},rotation:0 }
    const before = JSON.stringify(part), board = detailedSwitchboard(part,{color:'#B68C61',rough:.4})
    assert.deepEqual(board.position.toArray(),part.position)
    const socket = board.getObjectByName('Socket face with real open apertures')
    assert.equal(socket.geometry.parameters.shapes.holes.length,3)
    assert.equal(socket.material.color.getHexString(),'b68c61')
    const bounds = new Box3().setFromObject(board), size = bounds.getSize(board.position.clone())
    size.toArray().forEach((v,i) => assert.ok(v <= part.size[i]+.001,`${i}: ${v}`))
    assert.equal(JSON.stringify(part),before)
    disposeWalkthroughAsset(board)
  }
})

test('plant refinement is deterministic, instanced and stays inside the existing furniture envelope', () => {
  const parts = [
    {id:'pot',sourceIds:['living-plant-0-pot'],position:[2,.15,3],size:[.36,.3,.36]},
    {id:'leaf',sourceIds:['living-plant-0-leaf0'],position:[2,.8,3],size:[.65,.8,.65]},
  ].map(p => ({...p,roomId:'living',rotation:0}))
  assert.equal(indoorPlantGroups(parts).length,1)
  const a=detailedIndoorPlant(parts), b=detailedIndoorPlant(parts)
  const leaves=a.children.find(o=>o instanceof InstancedMesh), other=b.children.find(o=>o instanceof InstancedMesh)
  assert.equal(leaves.count,26)
  assert.deepEqual(leaves.instanceMatrix.array,other.instanceMatrix.array)
  assert.ok(leaves.geometry.getAttribute('uv'))
  assert.ok(leaves.material.bumpMap)
  const bounds=new Box3().setFromObject(a), envelope=a.userData.envelope
  bounds.min.toArray().forEach((v,i)=>assert.ok(v>=envelope.min[i]-.001))
  bounds.max.toArray().forEach((v,i)=>assert.ok(v<=envelope.max[i]+.001))
  let released=false; leaves.addEventListener('dispose',()=>{released=true})
  disposeWalkthroughAsset(a); disposeWalkthroughAsset(b)
  assert.equal(released,true)
})

test('bathroom mirror removal preserves glazing, car mirrors and combined mesh parts', () => {
  const root=new Group(), bath=new Group(); bath.userData.roomId='bath'; root.add(bath)
  const add=(parent,name,ids)=>{const m=new Mesh(new BoxGeometry(),new MeshStandardMaterial());m.name=name;if(ids)m.userData.partIds=ids;parent.add(m);return m}
  const mirror=add(bath,'Vanity mirror'),glass=add(bath,'Shower glazing'),mixed=add(bath,'Combined mirror and glazing',['mirror','shower'])
  const car=add(root,'Car mirror')
  assert.equal(removeBathroomMirrors(root,{rooms:[{id:'bath',name:'Bathroom'}]}).length,1)
  assert.equal(mirror.visible,false)
  for(const mesh of [glass,mixed,car])assert.equal(mesh.visible,true)
  disposeWalkthroughAsset(root)
})
