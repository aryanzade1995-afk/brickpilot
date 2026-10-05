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
  assert.ok(scene);assert.ok(scene.furniture.length || scene.pieces.length, "the room is furnished")
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

test('the 360 room is dressed in exactly what was chosen on Finishes & Cost, and a changed choice is a new preview', async () => {
  const { interiorFinishes } = await import('../src/lib/interior/finishes.ts')
  const withSpecs = (overrides) => { const b = structuredClone(brief); b.specs = { overrides }; return { ...design, model: { ...design.model, brief: b } } }
  const plain = withSpecs({})
  const chosen = withSpecs({ 'kitchen-counter': 'granite', sanitary: 'svc-toilet-2', 'cp-fittings': 'svc-faucet-1', fans: 'svc-fans-2',
    'false-ceiling': 'ceiling-cove', 'bath-wall-tiles': 'wall-subway', 'light-fittings': 'svc-light-fittings-4', switches: 'svc-switches-1' })
  const room = (re) => previewRooms(design).find((r) => re.test(r.id))
  const kitchen = room(/^kitchen/), bath = room(/bath/), living = room(/^living/)
  const k = interiorFinishes(chosen, kitchen.floor, kitchen.id)
  assert.equal(k.counter.name, 'Granite'); assert.ok(k.counter.image, 'the counter uses the chosen surface texture')
  assert.equal(k.ceiling.type, 'cove'); assert.equal(k.lights.kind, 'panel'); assert.match(k.switches.image, /svc-switches-1/)
  const w = interiorFinishes(chosen, bath.floor, bath.id)
  assert.equal(w.sanitary.wc, 'wall', 'a wall-hung WC is drawn wall-hung'); assert.equal(w.fittings.finish, 'chrome')
  assert.equal(w.wallTiles.pattern, 'subway'); assert.equal(w.wallTiles.zone, 'full')
  assert.ok(!w.fan, 'no ceiling fan in a bathroom'); assert.ok(w.waterHeater)
  const l = interiorFinishes(chosen, living.floor, living.id)
  assert.match(l.fan.name, /Jupiter/); assert.match(l.fan.image, /svc-fans-2/)
  assert.ok(l.summary.some((s) => s.label === 'Fans' && /Jupiter/.test(s.value)))
  // generic allowances never show a material texture as a fixture's picture
  const p = interiorFinishes(plain, bath.floor, bath.id)
  assert.equal(p.switches.image, undefined); assert.equal(p.sanitary.image, undefined)
  // the panorama's identity includes the finishes: change one and it is rendered again
  const scene = (d) => { const s = createInteriorScene(d, 'fixture', defaultConfiguration(kitchen.id, kitchen.floor), brief.style.character); s.finishes = interiorFinishes(d, kitchen.floor, kitchen.id); return s }
  assert.notEqual(previewKey(scene(plain)), previewKey(scene(chosen)))
  assert.equal(previewKey(scene(chosen)), previewKey(scene(chosen)))
})

test('rooms are furnished by rule: key pieces present, nothing in a door swing, nothing overlapping, nothing tall over glass, a clear standing spot', async () => {
  const { clearRoom } = await import('../src/lib/interior/layout.ts')
  const want = { living: ['sofa', 'tv-unit'], bed: ['bed'], dining: ['dining-table', 'dining-chair'], study: ['desk', 'chair'] }
  const solid = (t) => !['rug', 'curtain', 'art', 'pendant', 'tv', 'table-lamp'].includes(t)
  const fp = (p) => { const [w, d] = p.face === 'N' || p.face === 'S' ? [p.w, p.d] : [p.d, p.w]; return { x0: p.x - w / 2, x1: p.x + w / 2, z0: p.z - d / 2, z1: p.z + d / 2 } }
  const hit = (a, b, m = 0) => a.x0 < b.x1 - m && a.x1 > b.x0 + m && a.z0 < b.z1 - m && a.z1 > b.z0 + m
  let checked = 0
  for (const r of previewRooms(design)) {
    const scene = createInteriorScene(design, 'fixture', defaultConfiguration(r.id, r.floor), brief.style.character)
    if (!scene.pieces.length) continue
    checked++
    const room = clearRoom(scene.shell, scene.room.dims), types = scene.pieces.map((p) => p.type)
    for (const [k, list] of Object.entries(want)) if (new RegExp(k, 'i').test(r.id)) for (const t of list) assert.ok(types.includes(t), `${r.id} has a ${t}`)
    const pieces = scene.pieces.filter((p) => solid(p.type))
    for (const p of pieces) {
      const f = fp(p)
      assert.ok(f.x0 >= room.x0 - 1e-6 && f.x1 <= room.x1 + 1e-6 && f.z0 >= room.z0 - 1e-6 && f.z1 <= room.z1 + 1e-6, `${p.id} inside the room`)
      for (const q of pieces) if (q !== p && !(p.type === 'dining-chair' || q.type === 'dining-chair' || p.type === 'chair' || q.type === 'chair')) assert.ok(!hit(f, fp(q), 0.01), `${p.id} clear of ${q.id}`)
      for (const o of scene.openings.filter((o) => o.kind !== 'window' && o.alongM !== undefined)) {
        const swing = o.widthM > 1.2 ? 0.8 : Math.min(o.widthM, 1.0) + 0.1, h = o.widthM / 2
        const zone = o.side === 'N' ? { x0: o.alongM - h, x1: o.alongM + h, z0: room.z0, z1: room.z0 + swing } : o.side === 'S' ? { x0: o.alongM - h, x1: o.alongM + h, z0: room.z1 - swing, z1: room.z1 }
          : o.side === 'W' ? { x0: room.x0, x1: room.x0 + swing, z0: o.alongM - h, z1: o.alongM + h } : { x0: room.x1 - swing, x1: room.x1, z0: o.alongM - h, z1: o.alongM + h }
        assert.ok(!hit(f, zone, 0.25), `${p.id} out of the swing of the ${o.side} door`)
      }
      if (p.h > 1.5) for (const o of scene.openings.filter((o) => o.kind === 'window' && o.alongM !== undefined && o.side !== p.face)) {
        const back = { N: 'S', S: 'N', E: 'W', W: 'E' }[p.face]
        if (o.side !== back) continue
        const c = o.side === 'N' || o.side === 'S' ? p.x : p.z
        assert.ok(Math.abs(c - o.alongM) >= (o.widthM + p.w) / 2 - 0.01, `${p.id} (tall) not in front of glass`)
      }
    }
    const [cx, , cz] = scene.camera
    for (const p of pieces) { const f = fp(p); assert.ok(!(cx > f.x0 && cx < f.x1 && cz > f.z0 && cz < f.z1), `camera not inside ${p.id}`) }
  }
  assert.ok(checked >= 5, 'living, dining, bedrooms and study are all furnished')
})
