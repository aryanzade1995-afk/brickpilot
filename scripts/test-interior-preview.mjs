import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { createInteriorScene, defaultConfiguration, previewRooms } from '../src/lib/interior/preview.ts'
import { previewKey, renderPreview, validateConfiguration } from '../server/interior-preview.mjs'
const brief=defaultBrief();brief.site.plotWidth=18;brief.site.plotDepth=24
const design=generate(compile(brief),{seed:41})
assert.ok(validate(design).hardChecksPass)
const original=JSON.stringify(design)
for(const kind of ['living','bed','kitchen']) test(`${kind}: source geometry, customization, cache and optional Eevee runtime`,async()=> {
  const room=previewRooms(design).find(r=>new RegExp(kind,'i').test(r.id+' '+r.name))
  assert.ok(room,`missing ${kind}`)
  const config=defaultConfiguration(room.id,room.floor)
  if(kind==='bed') {config.style='scandinavian';config.flooring={material:'light-wood',color:'#C9A47C'};config.walls.color='#F4F0E8';config.ceiling.type='tray';config.lighting='warm'}
  if(kind==='kitchen') {config.style='contemporary';config.flooring={material:'ceramic-tile',color:'#B9B8B5'};config.walls.color='#FAFAF7';config.ceiling.type='plain';config.lighting='daylight'}
  validateConfiguration(config,'fast')
  const scene=createInteriorScene(design,'fixture',config,brief.style.character)
  assert.ok(scene);assert.ok(scene.furniture.length)
  const building=createBuildingModel(design),floor=building.floors.find(f=>f.level===room.floor)
  assert.equal(scene.room.dims.h,(floor.heightMm-floor.slabThicknessMm)/1000)
  const variant=createInteriorScene(design,'fixture',{...config,style:'luxury',walls:{color:'#4A4A48'}},brief.style.character,'high')
  assert.deepEqual(scene.shell,variant.shell)
  assert.notEqual(previewKey(scene),previewKey(variant))
  assert.equal(previewKey(scene),previewKey(JSON.parse(JSON.stringify(scene))))
  assert.equal(JSON.stringify(design),original)
  assert.ok(scene.shell.filter(b=>b.id.startsWith('column')).length)
  const sourceRoom=building.rooms.find(r=>r.floorId===floor.id && r.id===room.id)
  assert.equal(scene.room.dims.w,sourceRoom.rect.w/1000)
  assert.equal(scene.room.dims.d,sourceRoom.rect.h/1000)
  for(const opening of scene.openings) {
    const source=[...building.doors,...building.windows].find(o=>o.id===opening.id)
    assert.ok(source)
    assert.equal(opening.widthM,source.width/1000)
    assert.equal(opening.sillM,source.kind==='window'?(source.sill??floor.openingLimits.defaultSillMm)/1000:0)
    const centre=source.orient==='h'?sourceRoom.rect.x+sourceRoom.rect.w/2:sourceRoom.rect.y+sourceRoom.rect.h/2
    assert.equal(opening.alongM,((source.orient==='h'?source.at.x:source.at.y)-centre)/1000)
  }
  if(process.env.INTERIOR_RUNTIME==='1') {
    const render=async(s)=> {
      if(process.env.INTERIOR_API!=='1') return renderPreview(s)
      const response=await fetch('http://localhost:8787/api/interior-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({design,config:s.config,quality:s.quality})})
      const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data
    }
    const checkImage=async(result,width,height)=> {
      const bytes=process.env.INTERIOR_API==='1'?Buffer.from(await (await fetch(`http://localhost:8787${result.url}`)).arrayBuffer()):await readFile(resolve('output/interior',result.cachePath,'preview-360.webp'))
      assert.equal(bytes.toString('ascii',0,4),'RIFF')
      const type=bytes.toString('ascii',12,16)
      let w,h
      if(type==='VP8 ') {w=bytes.readUInt16LE(26)&0x3fff;h=bytes.readUInt16LE(28)&0x3fff}
      else if(type==='VP8L') {const bits=bytes.readUInt32LE(21);w=(bits&0x3fff)+1;h=((bits>>>14)&0x3fff)+1}
      else {w=bytes.readUIntLE(24,3)+1;h=bytes.readUIntLE(27,3)+1}
      assert.deepEqual([w,h],[width,height])
    }
    const [result, duplicate]=await Promise.all([render(scene),render(scene)])
    assert.equal(result.key,duplicate.key,'identical concurrent requests share the output')
    assert.deepEqual(JSON.parse(await readFile(resolve('output/interior',result.cachePath,'config.json'),'utf8')),config)
    await checkImage(result,2048,1024)
    console.log(`${kind} ${result.url}`)
    assert.equal((await render(scene)).cached,true)
    if(kind==='living') {const high=await render({...scene,quality:'high'});await checkImage(high,4096,2048);console.log('high',high)}
  }
})
test('invalid selection and configuration rejected',()=> {
  assert.equal(createInteriorScene(design,'fixture',defaultConfiguration('missing',99),brief.style.character),null)
  assert.throws(()=>validateConfiguration({...defaultConfiguration('room',0),lighting:'invalid'},'fast'))
})
test('explicit source opening heights are retained',()=> {
  const edited=structuredClone(design),room=previewRooms(edited).find(r=>/living/i.test(r.id))
  const floor=edited.floors.find(f=>f.level===room.floor)
  const window=floor.openings.find(o=>o.kind==='window' && o.rooms?.includes(room.id))
  assert.ok(window);window.sill=740;window.head=2240
  const scene=createInteriorScene(edited,'fixture',defaultConfiguration(room.id,room.floor),brief.style.character)
  const output=scene.openings.find(o=>o.id===window.id)
  assert.equal(output.sillM,.74);assert.equal(output.headM,2.24)
})
test('double-height source void is never replaced with an invented ceiling',()=> {
  const edited=structuredClone(design),room=edited.floors[0].rooms.find(r=>r.id==='living')
  edited.floors[1].doubleHeightVoids=[{rect:room.rect,sourceRoomId:room.semanticId,roomId:'doubleHeightLiving'}]
  assert.throws(()=>createInteriorScene(edited,'fixture',defaultConfiguration(room.id,0),brief.style.character),/double-height/)
})
test('Blender startup failure is useful and retryable',{skip:process.env.INTERIOR_RUNTIME!=='1'},async()=> {
  const room=previewRooms(design).find(r=>/living/i.test(r.id)),config=defaultConfiguration(room.id,room.floor)
  config.walls.color='#123ABC'
  const scene=createInteriorScene(design,'startup-failure-fixture',config,brief.style.character)
  const previous=process.env.BLENDER_BIN
  process.env.BLENDER_BIN=resolve('output/nonexistent-test-blender.exe')
  try {await assert.rejects(renderPreview(scene),/Blender could not start/);await assert.rejects(renderPreview(scene),/Blender could not start/)}
  finally {if(previous===undefined)delete process.env.BLENDER_BIN;else process.env.BLENDER_BIN=previous}
})
