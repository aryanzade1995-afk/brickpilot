import { mkdir, writeFile } from 'node:fs/promises'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { openSpaceBrief } from './fixtures/open-space-brief.mjs'

const directory = 'output/planning-review'
await mkdir(directory, { recursive: true })
const designs = {}
for (const mode of ['auto', 'perSide', 'chosenSides', 'maxBuild']) {
  const design = generate(compile(openSpaceBrief(mode)))
  const report = validate(design)
  if (!report.hardChecksPass) throw new Error(`${mode}: ${JSON.stringify(report.findings)}`)
  designs[mode] = design
}
await writeFile(`${directory}/designs.json`, JSON.stringify(designs))
await writeFile(`${directory}/index.html`, `<!doctype html><html><head><meta charset="utf-8"><title>Formstead · Planning verification</title></head><body><div id="root"></div><script type="module" src="./review.tsx"></script></body></html>`)
await writeFile(`${directory}/review.tsx`, `import React, { useState } from 'react';
import {createRoot} from 'react-dom/client';
import {DrawingWorkspace} from '/src/components/DrawingWorkspace.tsx';
import '/src/index.css';
import designs from './designs.json';
const labels={auto:'Auto',perSide:'Per side',chosenSides:'Chosen sides',maxBuild:'Max build'};
function Review(){const [mode,setMode]=useState('auto');const d=designs[mode];return <main style={{maxWidth:1440,margin:'auto',padding:28}}>
<h1 style={{fontSize:26,marginBottom:8}}>Formstead · Open-space comparison</h1>
<p style={{fontSize:13,color:'#888',marginBottom:18}}>One 18 × 22 m plot · same household, rooms and budget · all hard checks pass · existing drawing components</p>
<nav style={{display:'flex',gap:8,marginBottom:20}}>{Object.keys(labels).map(m=><button key={m} onClick={()=>setMode(m)} aria-pressed={mode===m} style={{border:'1px solid '+(mode===m?'#ddd':'#444'),padding:'8px 16px',color:mode===m?'var(--color-ink)':'#777'}}>{labels[m]}</button>)}</nav>
<p style={{fontSize:13,marginBottom:18}}>{labels[mode]} · {d.candidate} · enclosed footprint {d.footprintSqm.toFixed(1)} m² · {(d.footprintSqm/(d.model.envelope.width*d.model.envelope.depth/1e6)*100).toFixed(1)}% permitted-area use · 0 errors</p>
<DrawingWorkspace design={d}/></main>};const root=createRoot(document.getElementById('root')); root.render(<Review/>); if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount());`)
console.log(`Planning verification: /${directory}/index.html`)
console.log(Object.fromEntries(Object.entries(designs).map(([mode,d]) => [mode, { family: d.candidate, footprintSqm: d.footprintSqm,
  usagePercent: +(d.footprintSqm / (d.model.envelope.width * d.model.envelope.depth / 1e6) * 100).toFixed(1) }])))
