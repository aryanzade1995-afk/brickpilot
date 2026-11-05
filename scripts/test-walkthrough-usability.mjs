import test from 'node:test'
import assert from 'node:assert/strict'
import {Group,Mesh,BoxGeometry,MeshStandardMaterial} from 'three'
import {wallSideDoorSwing} from '../src/lib/walkthrough/doorSwing.ts'
import {walkthroughLocation} from '../src/lib/walkthrough/location.ts'
import {createGuideContext} from '../src/lib/walkthrough/guide.ts'
import {describeRoom} from '../src/lib/walkthrough/roomExperience.ts'
import {acceptedVillaCollision} from '../src/lib/three/acceptedVillaWalkthrough.ts'
import {batchWalkthroughScene} from '../src/lib/three/walkthroughBatches.ts'

const room={id:'bath',floorId:'GF',name:'Bathroom',outdoor:false,rectMm:{x:0,y:0,w:3000,h:3000},elevationM:0}
const opening={id:'door',sourceId:'D',floorId:'GF',rooms:['bath','hall'],kind:'door',operation:'door-leaf-unmodelled',orient:'h',apertureMm:{x:200,y:-60,z:0,w:900,d:120,h:2100}}
test('hinged leaves open beside the closest wall return in either orientation and into the private room',()=>{
 const hall={...room,id:'hall',name:'Corridor',rectMm:{x:0,y:-1000,w:3000,h:1000}}
 assert.deepEqual(wallSideDoorSwing(opening,[hall,room]),{hinge:'a',swing:1})
 assert.deepEqual(wallSideDoorSwing({...opening,apertureMm:{...opening.apertureMm,x:1900}},[hall,room]),{hinge:'b',swing:1})
 assert.deepEqual(wallSideDoorSwing({...opening,orient:'v',apertureMm:{x:-60,y:200,z:0,w:120,d:900,h:2100}},[room]),{hinge:'a',swing:1})
 assert.deepEqual(wallSideDoorSwing({...opening,orient:'v',apertureMm:{x:2940,y:1900,z:0,w:120,d:900,h:2100}},[room]),{hinge:'b',swing:-1})
 const slider={...opening,operation:'sliding',hinge:'b',swing:-1}
 assert.deepEqual(wallSideDoorSwing(slider,[room]),{hinge:'b',swing:-1})
})
test('every accepted leaf gains moving, two-sided knobs without duplicated hardware or altered frame buffers',()=>{
 const root=new Group(),leaf=new Mesh(new BoxGeometry(.9,2.1,.04),new MeshStandardMaterial())
 leaf.name='Door_D_Leaf';leaf.position.set(.65,1.05,0);leaf.userData.source_id='D'
 const frame=leaf.clone();frame.name='Door_D_Head';frame.position.y=2.1;root.add(leaf,frame)
 const positions=[...frame.geometry.attributes.position.array]
 const first=acceptedVillaCollision(root,[opening],[room])
 assert.equal(first.doors[0].hinge,'a')
 const knobs=root.getObjectByName('Walkthrough_Knobs_door:single')
 assert.ok(knobs);assert.equal(knobs.userData.walkthroughDoorId,leaf.userData.walkthroughDoorId)
 knobs.geometry.computeBoundingBox();const bounds=knobs.geometry.boundingBox
 assert.ok(bounds.min.z<-.04&&bounds.max.z>.04,'visible knobs on both faces')
 assert.equal(frame.userData.walkthroughDoorId,undefined)
 acceptedVillaCollision(root,[opening],[room]);assert.equal(root.children.filter(o=>o.userData.doorHardware).length,1)
 assert.deepEqual([...frame.geometry.attributes.position.array],positions)
})
const metadata={planId:'test',floors:[{sourceId:'GF',level:0,elevationM:0},{sourceId:'FF',level:1,elevationM:3}],rooms:[{...room,id:'bed',name:'Bedroom',rectMm:{x:0,y:0,w:6000,h:6000}},room,{...room,id:'upper-bath',floorId:'FF',elevationM:3}],stairs:[],openings:[],roofs:[{id:'roof',floorId:'FF',elevationM:6,regionsMm:[{x:0,y:0,w:6000,h:6000}],access:'source-stair'}]}
test('narration follows the actual floor and containing bathroom, then the separate roof terrace',()=>{
 assert.equal(walkthroughLocation(metadata,{x:1,y:0,z:-1},'GF').roomId,'bath')
 assert.equal(walkthroughLocation(metadata,{x:1,y:3,z:-1},'FF').roomId,'upper-bath')
 const location=walkthroughLocation(metadata,{x:1,y:6,z:-1},'FF')
 assert.equal(location.roomId,'roof');assert.equal(location.floor,2)
 const context=createGuideContext(metadata,undefined,location.roomId)
 assert.ok(context);assert.equal(context.currentRoomId,'roof')
 for(const language of ['en','mr','hi'])assert.ok(describeRoom(context,language)?.length>30)
 assert.equal(walkthroughLocation(metadata,{x:10,y:6,z:-10},'FF').roomId,undefined)
})
test('static matrices freeze reversibly while animated door transforms remain live',()=>{
 const root=new Group(),wall=new Mesh(new BoxGeometry(),new MeshStandardMaterial()),door=wall.clone()
 door.userData.walkthroughDoorId='D';root.add(wall,door)
 const batch=batchWalkthroughScene(root)
 assert.equal(wall.matrixAutoUpdate,false);assert.equal(wall.matrixWorldAutoUpdate,false)
 assert.equal(door.matrixWorldAutoUpdate,true)
 door.position.x=2;root.updateMatrixWorld(true);assert.equal(door.matrixWorld.elements[12],2)
 batch.release();assert.equal(wall.matrixAutoUpdate,true);assert.equal(wall.matrixWorldAutoUpdate,true)
})
