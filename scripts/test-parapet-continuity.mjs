import test from 'node:test'
import assert from 'node:assert/strict'
import {context,sourceFixture} from './fixtures/specialized-building.mjs'
import {makeRoofline} from '../src/lib/engine/facade/specialized/rooflines.ts'
import {rectUnionEdges} from '../src/lib/geometry.ts'

function fixture(){
  const ctx=context(sourceFixture(),true),top=ctx.building.floors.at(-1)
  top.footprint=[{x:3000,y:3000,w:4000,h:4000},{x:7000,y:3300,w:3000,h:3700}]
  top.outline={x:3000,y:3000,w:7000,h:4000};top.courtyard=null;top.doubleHeightVoids=[]
  ctx.building.stairs=[];ctx.building.shafts=[]
  return {ctx,top}
}

test('short roof-step returns retain solid parapets for every perimeter segment',()=>{
  for(const type of ['FLAT_PARAPET','STEPPED_PARAPET','OFFSET_PARAPET','PLANTER_PARAPET']){
    const {ctx,top}=fixture(),unit=makeRoofline(ctx,type)
    const rails=unit.parts.filter(p=>p.role==='rail').map(p=>p.world)
    assert.ok(rails.some(r=>r.w===120&&r.h===300)||rails.some(r=>r.w===260&&r.h===300),type)
    for(const edge of rectUnionEdges(top.footprint)){
      const h=edge.side==='N'||edge.side==='S',inset=type==='OFFSET_PARAPET'?180:0
      const offset=inset+(type==='PLANTER_PARAPET'?130:60)
      const x=(edge.a.x+edge.b.x)/2+(h?0:edge.side==='W'?offset:-offset)
      const y=(edge.a.y+edge.b.y)/2+(h?(edge.side==='N'?offset:-offset):0)
      assert.ok(rails.some(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h),`${type}: ${edge.side} missing wall`)
    }
  }
})

test('short pieces beside a shaft are retained without sealing the actual shaft',()=>{
  const {ctx,top}=fixture()
  const cut={x:3300,y:3000,w:1000,h:500}
  ctx.building.shafts=[{id:'shaft',floorId:top.id,rect:cut}]
  const unit=makeRoofline(ctx,'FLAT_PARAPET')
  assert.ok(unit.parts.some(p=>p.world.x===3000&&p.world.y===3000&&p.world.w===300&&p.world.h===120))
  for(const {world:r} of unit.parts)assert.ok(!(r.x<cut.x+cut.w&&r.x+r.w>cut.x&&r.y<cut.y+cut.h&&r.y+r.h>cut.y))
})

test('narrow planter returns stay solid without creating negative-size soil caps',()=>{
  const {ctx,top}=fixture()
  ctx.building.shafts=[{id:'shaft',floorId:top.id,rect:{x:3020,y:3000,w:1000,h:500}}]
  const unit=makeRoofline(ctx,'PLANTER_PARAPET')
  assert.ok(unit.parts.some(p=>p.role==='rail'&&p.world.x===3000&&p.world.y===3000&&p.world.w===20))
  assert.ok(unit.parts.every(p=>p.local.w>0&&p.local.d>0&&p.local.h>0))
})
