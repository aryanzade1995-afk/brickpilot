import fs from 'node:fs/promises'
import {requestLighting} from '../server/walkthrough-lighting.mjs'
const dir=process.argv[2],quality=process.argv[3]??'balanced'
if(!dir)throw new Error('Pass an accepted villa job directory')
const {plan}=JSON.parse(await fs.readFile(dir+'/request.json','utf8')),accepted=JSON.parse(await fs.readFile(dir+'/accepted.json','utf8'))
const job=await requestLighting({projectId:'accepted-'+dir.split(/[\\/]/).at(-1),expectedPlanId:accepted.planId,design:plan,preferences:{style:'indian-contemporary',lighting:'warm',furnitureDensity:'medium'},acceptedUrl:`/api/villas/${dir.split(/[\\/]/).at(-1)}/files/${accepted.files.find(f=>f.endsWith('.glb'))}`,lightingQuality:quality})
await fs.writeFile('output/furniture-sources/lighting-job.json',JSON.stringify({id:job.id,quality}))
console.log('LIGHTING_JOB',job.id,job.status)
while(!['ready','failed'].includes(job.status)){await new Promise(r=>setTimeout(r,5000));console.log(job.status,job.stage)}
if(job.status==='failed')throw new Error(job.detail??job.error)
console.log('LIGHTING_READY',job.id)
