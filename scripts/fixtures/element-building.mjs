import { sourceFixture } from './specialized-building.mjs'
import { terraceFreeRatio } from '../../src/lib/engine/terrace.ts'
export function elementFixture() {
 const b=sourceFixture(25,25,41,true), top=b.floors.at(-1)
 b.siteRequirements={compoundWall:true}
 b.siteFeatures=[
  {id:'GATE_DRIVE',kind:'driveway',name:'Driveway',rect:{x:19600,y:23000,w:4000,h:4000},covered:false},
  {id:'POOL_SIT',kind:'sitOut',name:'Pool terrace',rect:{x:2000,y:21000,w:3000,h:2000},covered:false},
  {id:'POOL',kind:'pool',name:'Pool',rect:{x:5500,y:21000,w:3500,h:2000},covered:false},
 ]
 const roof={level:top.level,slab:top.footprint,outline:top.outline,
  mumty:b.stairs.find(s=>s.floorId===top.id).rect,tank:null,pergola:null}
 b.roofTerrace={...roof,freeRatio:terraceFreeRatio(roof)}
 return b
}
