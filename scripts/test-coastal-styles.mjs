import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {defaultBrief,briefSchema,SELECTABLE_CHARACTERS} from '../src/lib/model/brief.ts'
import {THEMES} from '../src/lib/model/themes.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
import {deriveDesignDNA} from '../src/lib/engine/designDna.ts'
import {validate} from '../src/lib/rules/index.ts'
import {styleReference} from '../src/lib/gallery/referenceImages.ts'
import {buildMassing} from '../src/lib/three/buildMassing.ts'

test('both coastal styles generate valid 18x24 plans and exportable distinct roof/material identities',()=>{
 const signatures=[]
 for(const character of ['coastal-bungalow','tropical-beach-villa']){
  const brief=defaultBrief();brief.site.plotWidth=18;brief.site.plotDepth=24;brief.style.character=character
  const d=generate(compile(brief),{seed:41}),before=JSON.stringify(d)
  assert.equal(validate(d).hardChecksPass,true)
  const a=generateAlternativeDesign(d,41)
  assert.equal(a.facadeGrammar.status,'valid')
  assert.equal(a.villaDesignDNA.roofType,character==='coastal-bungalow'?'hip':'flat-terrace')
  const massing=buildMassing(d)
  assert.ok(massing.boxes.length)
  if(character==='coastal-bungalow')assert.ok(massing.boxes.some(b=>b.prism?.form==='hip'))
  assert.equal(THEMES[character].landscape.tropical,true)
  assert.equal(JSON.stringify(d),before)
  signatures.push(JSON.stringify([THEMES[character].roof,THEMES[character].materials]))
  for(let seed=0;seed<12;seed++)assert.equal(deriveDesignDNA('same-brief',seed,character,'rectangular','bold').styleFamily,character)
 }
 assert.notEqual(signatures[0],signatures[1])
 assert.equal(SELECTABLE_CHARACTERS.length,5)
})
test('the existing three themes retain their pre-change contents and legacy briefs still parse',()=>{
 const hashes={'modern-box':'26875ea9e0c8d67d60d10608d55acd27c65e4b06a49945a8579c6eedfc845496','contemporary-indian':'d54cf2d7d6501a98a7fdc734b10abde537cbbb66274f96d0463bc9882db43fa5','courtyard-indian':'2dfe38183afd97de1910f492e4e1f4c392ee328cc68c5b8fe662f512e980c66e'}
 for(const [id,hash] of Object.entries(hashes))assert.equal(createHash('sha256').update(JSON.stringify(THEMES[id])).digest('hex'),hash)
 for(const id of ['modern-box','contemporary-indian','courtyard-indian','modern-kerala','tropical-indian','modernist','warm-minimal'])assert.ok(briefSchema.safeParse({style:{character:id}}).success,id)
})
test('reference photos are separate from Blender images, with credits and graceful missing-file states',()=>{
 for(const id of ['coastal-bungalow','tropical-beach-villa']){
  const r=styleReference(id,[]);assert.ok(r.alt&&r.credit&&r.licence)
  assert.equal(r.available,false);assert.equal(styleReference(id,[r.src]).available,true)
  assert.match(r.src,new RegExp(`/reference/${id}\\.jpg$`))
 }
 assert.equal(styleReference('modern-box'),null)
})
