import fs from 'node:fs/promises'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { buildWalkthroughScene } from '../src/lib/walkthrough/scene.ts'
import { prepareWalkthroughGeometry } from '../src/lib/walkthrough/delivery.ts'
const source=process.argv[2]
if(!source)throw new Error('Pass the accepted villa job directory as the first argument')
const request=JSON.parse(await fs.readFile(source+'/request.json','utf8'))
const previous=JSON.parse(await fs.readFile(source+'/candidates/'+request.seed+'/input.json','utf8'))
const payload={...generateAlternativeDesign(request.plan,request.seed),specifications:previous.specifications}
if(payload.buildingModel.planId!==previous.buildingModel.planId)throw new Error('Detail upgrade changed architectural identity')
const scene=buildWalkthroughScene(payload.buildingModel,{hardChecksPass:true})
const geometry=prepareWalkthroughGeometry(scene)
await fs.mkdir('output/doors-pipes-validation',{recursive:true})
await fs.writeFile('output/doors-pipes-validation/input.json',JSON.stringify(payload))
await fs.writeFile('output/doors-pipes-validation/geometry.json',JSON.stringify(geometry))
await fs.writeFile('output/doors-pipes-validation/layout.json',JSON.stringify(payload.plumbing))
console.log(JSON.stringify({planId:payload.buildingModel.planId,seed:request.seed,sliders:payload.balconySliders,roof:payload.roofAccess?.opening,issues:scene.issues.filter(i=>i.severity==='error')}))
