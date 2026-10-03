import {mkdir,writeFile,readdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {estimateBoq} from '../src/lib/cost/boq.ts'
import {boqCsv} from '../src/lib/cost/index.ts'
import {performance} from 'node:perf_hooks'

const folder='output/boq-review'
await mkdir(folder,{recursive:true})
const brief=defaultBrief(),design=generate(compile(brief)),report=validate(design)
if(!report.hardChecksPass)throw new Error('Review source plan is invalid')
const initial=estimateBoq(design,brief)
brief.specs.overrides={'glass':'double','main-door':'hardwood',solar:'on'}
const start=performance.now(),cost=estimateBoq(design,brief),repriceMs=performance.now()-start
const server=await createServer({configFile:false,resolve:{alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}},
 optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'})
try{
 const {buildReportPdf}=await server.ssrLoadModule('/src/lib/report/buildPdf.ts')
 const {CostSummary,BoqTable}=await server.ssrLoadModule('/src/components/CostSummary.tsx')
 const pdf=await buildReportPdf({projectName:'Measured BOQ review',brief,design,report,cost,planImages:[],massingImages:[],conceptImages:[]})
 await writeFile(`${folder}/formstead-cost-review.pdf`,Buffer.from(await pdf.arrayBuffer()))
 await writeFile(`${folder}/boq.csv`,boqCsv(cost))
 await writeFile(`${folder}/boq.json`,JSON.stringify({repriceMs,defaultExpected:initial.expected,cost},null,2))
 const css=(await readdir('dist/assets')).find(f=>/^index-.*\.css$/.test(f))
 const body=renderToStaticMarkup(React.createElement('main',{className:'mx-auto max-w-5xl p-8'},
  React.createElement('h1',{className:'font-display text-3xl mb-6'},'Measured BOQ review'),
  React.createElement(CostSummary,{cost}),React.createElement(BoqTable,{cost})))
 await writeFile(`${folder}/index.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Measured BOQ review</title><link rel="stylesheet" href="../../dist/assets/${css}"><body>${body}</body></html>`)
 console.log(JSON.stringify({expected:cost.expected,ratePerSqft:cost.ratePerSqft,repriceMs,lines:cost.boq.length,hardChecksPass:report.hardChecksPass,pdf:`${folder}/formstead-cost-review.pdf`}))
}finally{await server.close()}
