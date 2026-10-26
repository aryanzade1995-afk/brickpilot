import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {Texture} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {prepareWalkthroughShell} from '../src/lib/three/walkthroughShell.ts'
import {reconcileAcceptedFittingSupports} from '../src/lib/three/acceptedFittingSupports.ts'
const dir=process.argv[2]
if(!dir)throw new Error('Pass the accepted villa job directory')
const accepted=JSON.parse(await fs.readFile(dir+'/accepted.json','utf8'))
const bytes=await fs.readFile(accepted.directory+'/'+accepted.files.find(f=>f.endsWith('.glb')))
const loader=new GLTFLoader().register(()=>({name:'QA',loadTexture:()=>Promise.resolve(new Texture())}))
const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
const app=JSON.parse(await fs.readFile('output/furniture-sources/appearance.json','utf8'))
prepareWalkthroughShell(scene)
const view=reconcileAcceptedFittingSupports(app,scene),fittings=view.furniture.filter(p=>p.support)
assert.ok(fittings.length>50)
for(const model of view.models)assert.ok(model.replaces.every(id=>view.furniture.some(p=>p.id===id)))
console.log(JSON.stringify({acceptedPlanId:accepted.planId,checkedFittings:app.furniture.filter(p=>p.support).length,visibleSupportedFittings:fittings.length,unsupported:app.furniture.filter(p=>p.support&&!fittings.some(f=>f.id===p.id)).map(p=>p.sourceIds[0])}))
