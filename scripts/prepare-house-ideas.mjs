import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { HOUSE_IDEA_COMBINATIONS, houseIdeaKey } from '../src/lib/gallery/houseIdeas.ts'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { SITE_FORM_VERSION } from '../src/lib/engine/siteForm.ts'
import { expandBalconyArea } from '../src/lib/engine/balconyExtent.ts'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'

const root=resolve('output/house-ideas'), entries=[]
await mkdir(root,{recursive:true})
for(const selection of HOUSE_IDEA_COMBINATIONS){
 const id=houseIdeaKey(selection), file=resolve(root,`${id}.json`)
 let entry={...selection,id,status:'unavailable'}, reasons=[]
 try {
  const cached=JSON.parse(await readFile(file,'utf8')), e=cached.entry
  if(e.status==='ready'&&e.layout!=='auto'&&e.actualLayout!==e.layout){e.status='unavailable';delete e.image;e.reason='This composition uses a different building layout. Choose Auto layout or another composition.';await writeFile(file,JSON.stringify(cached))}
  if(e.status==='ready'||e.actualLayout||!process.argv.includes('--retry-unavailable')){entries.push(e);continue}
 } catch {}
 for(const size of [[25,30],[24,30],[22,28],[28,34],[34,40],[40,46]]){
  for(const seed of [41,73,119]){
   try{
    const b=defaultBrief();b.project.name='Formstead style library';b.project.buildingType=selection.type
    b.site.plotWidth=size[0];b.site.plotDepth=size[1];b.levels.storeys=selection.storeys
    b.style.character=selection.style;b.style.massing=selection.layout
    if(selection.composition!=='auto')b.style.composition=selection.composition
    const plan=expandBalconyArea(generate(compile(b),{massing:selection.layout,seed,formVersion:SITE_FORM_VERSION}))
    if(selection.layout!=='auto'&&plan.massingType!==selection.layout)throw new Error('This composition uses a different building layout. Choose Auto layout or another composition.')
    if(!validate(plan).hardChecksPass)throw new Error('Reference floor plan did not pass validation')
    const payload=generateAlternativeDesign(plan,650523944)
    entry={...selection,id,status:'ready',image:`/house-ideas/${id}.png`,planId:payload.buildingModel.planId,seed:650523944,actualLayout:plan.massingType,plotMetres:size}
    await writeFile(file,JSON.stringify({entry,payload}));break
   }catch(error){reasons.push(error.message)}
  }
  if(entry.status==='ready')break
 }
 if(entry.status!=='ready'){entry.reason=[...new Set(reasons)].join('; ');await writeFile(file,JSON.stringify({entry}))}
 entries.push(entry)
 console.log(`${entries.length}/${HOUSE_IDEA_COMBINATIONS.length} ${entry.status} ${id}`)
}
await writeFile(resolve(root,'index.json'),JSON.stringify({schemaVersion:1,source:'Blender',examplesOnly:true,entries},null,2))
console.log(JSON.stringify({total:entries.length,ready:entries.filter(e=>e.status==='ready').length,unavailable:entries.filter(e=>e.status!=='ready').length}))
