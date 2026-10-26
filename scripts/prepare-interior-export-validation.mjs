import fs from 'node:fs/promises'
import {createWalkthroughSource} from '../src/lib/walkthrough/source.ts'
import {buildWalkthroughScene} from '../src/lib/walkthrough/scene.ts'
import {prepareWalkthroughGeometry,prepareWalkthroughAppearance} from '../src/lib/walkthrough/delivery.ts'
import {validate} from '../src/lib/rules/index.ts'
const dir=process.argv[2]
if(!dir)throw new Error('Pass the accepted villa job directory')
const {plan}=JSON.parse(await fs.readFile(dir+'/request.json','utf8')),accepted=JSON.parse(await fs.readFile(dir+'/accepted.json','utf8'))
const report=validate(plan),source=createWalkthroughSource(plan,report,{style:'indian-contemporary',lighting:'warm',furnitureDensity:'medium'})
if(source.building.planId!==accepted.planId)throw new Error('Different accepted architecture')
const geometry=prepareWalkthroughGeometry(buildWalkthroughScene(source.building,report)),app=prepareWalkthroughAppearance(plan,source,geometry)
await fs.mkdir('output/furniture-sources',{recursive:true})
await fs.writeFile('output/furniture-sources/appearance.json',JSON.stringify(app))
await fs.writeFile('output/furniture-sources/geometry.json',JSON.stringify(geometry))
console.log(JSON.stringify({planId:accepted.planId,seed:accepted.seed,models:app.models.length,wallWc:app.models.find(m=>m.assetId==='toilet-wall')?.size}))
