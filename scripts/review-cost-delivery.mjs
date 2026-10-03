import {createServer} from 'vite'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {estimateProjectBoq} from '../src/lib/cost/index.ts'
import {specificationSchedule} from '../src/lib/cost/schedule.ts'
const dir='output/cost-delivery-review';await mkdir(dir,{recursive:true})
const brief=defaultBrief();brief.project.name='Formstead · finishes review'
const design=generate(compile(brief)),report=validate(design),cost=estimateProjectBoq(design,brief)
if(!report.hardChecksPass)throw Error('Review plan must pass hard checks')
const schedule=specificationSchedule(brief,cost),photos={}
for(const row of schedule)if(row.photo)photos[row.photo]='data:image/jpeg;base64,'+(await readFile(row.photo)).toString('base64')
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'})
try{
 const {buildBoqExcel}=await server.ssrLoadModule('/src/lib/cost/exportExcel.ts')
 const {buildSpecSheetPdf}=await server.ssrLoadModule('/src/lib/report/specSheet.ts')
 const {buildReportPdf}=await server.ssrLoadModule('/src/lib/report/buildPdf.ts')
 const images=[]
 for(const view of ['hero','front','aerial']){const file=`output/cost-integration/villa/villa_41_${view}.png`;try{images.push({label:`Visualisation (Blender) — ${view}`,dataUrl:'data:image/png;base64,'+(await readFile(file)).toString('base64')})}catch{}}
 await writeFile(`${dir}/boq.xlsx`,Buffer.from(await (await buildBoqExcel(cost,brief.project.name)).arrayBuffer()))
 await writeFile(`${dir}/specifications.pdf`,Buffer.from(await (await buildSpecSheetPdf({projectName:brief.project.name,schedule,cost,photos})).arrayBuffer()))
 await writeFile(`${dir}/report.pdf`,Buffer.from(await (await buildReportPdf({projectName:brief.project.name,brief,design,report,cost,planImages:[],massingImages:images,conceptImages:[],specPhotos:photos})).arrayBuffer()))
 const result={model:design.model,design,report,buildingModel:null,villaDesignDNA:null,massingModel:null,facadeModel:null,shapeFingerprint:null,shapeStatus:'replay',cost,generatedAt:0}
 await writeFile(`${dir}/fixture.json`,JSON.stringify({brief,result,images:['hero','front','aerial'].map(view=>({label:`Visualisation (Blender) — ${view}`,dataUrl:`/output/cost-integration/villa/villa_41_${view}.png`}))}))
 await writeFile(`${dir}/index.html`,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cost delivery review</title></head><body><div id="root"></div><script type="module" src="./review.tsx"></script></body></html>')
 await writeFile(`${dir}/review.tsx`, `import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {FinishesCostView} from '/src/routes/FinishesCost.tsx'
import {Report} from '/src/routes/Report.tsx'
import {useFinishes} from '/src/state/finishes.ts'
import '/src/index.css'
import fixture from './fixture.json'
function Review(){const [brief,setBrief]=useState(fixture.brief);const p=new URLSearchParams(location.search),tab=p.get('tab')||'specifications';return <MemoryRouter initialEntries={['/workspace/finishes?tab='+tab]}><p className="px-5 py-2 text-xs text-ink-faint">Review fixture · same validated plan · production components</p>{p.get('view')==='report'?<Report sourceResult={fixture.result} sourceBrief={brief} visualisations={fixture.images}/>:<FinishesCostView result={fixture.result} brief={brief} onBrief={setBrief}/>}</MemoryRouter>}
useFinishes.persist.setOptions({name:'formstead.delivery-review'});useFinishes.setState({entries:{},lastMeasured:null,quantitiesUpdated:false});createRoot(document.getElementById('root')).render(<Review/>);
`)
 console.log(`${dir}/index.html`)
}finally{await server.close()}
