import {mkdir,writeFile} from 'node:fs/promises'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {planFingerprint} from '../src/lib/engine/planner/planFingerprint.ts'
import {validate} from '../src/lib/rules/index.ts'

const directory='output/wing-review'
await mkdir(directory,{recursive:true})
const brief=defaultBrief();brief.project.buildingType='large-villa';brief.site.plotWidth=40;brief.site.plotDepth=60
brief.rooms.bedroomsWithBath=2;brief.rooms.bedroomsNoBath=0
const model=compile(brief),designs=[],summary=[]
for(let seed=1;seed<=50;seed++){
 const design=generate(model,{massing:'u-wing',seed}),report=validate(design)
 if(!report.hardChecksPass)throw new Error(`${seed}: ${JSON.stringify(report.findings)}`)
 designs.push(design);summary.push({requestedSeed:seed,planSeed:design.planSeed,family:design.massingType,
  fingerprint:planFingerprint(design).key,choices:design.layoutChoices,coveredPercent:design.coveredFootprintSqm/24})
}
const families=['twin-wing','u-wing','courtyard-ring','pavilion'].map(massing=>generate(model,{massing,seed:41}))
if(families.some(d=>!validate(d).hardChecksPass))throw new Error('Family comparison contains an invalid plan')
const unique=new Set(summary.map(d=>d.fingerprint)).size
await writeFile(`${directory}/designs.json`,JSON.stringify({designs,families,summary,unique}))
await writeFile(`${directory}/index.html`,'<!doctype html><html><head><meta charset="utf-8"><title>Formstead · Wing plan review</title></head><body><div id="root"></div><script type="module" src="./review.tsx"></script></body></html>')
await writeFile(`${directory}/review.tsx`, `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{DrawingWorkspace}from'/src/components/DrawingWorkspace.tsx';import{FloorDrawing}from'/src/lib/draw/FloorDrawing.tsx';
import'/src/index.css';import data from'./designs.json';
function Review(){const [index,setIndex]=useState(0),[family,setFamily]=useState(-1);const d=family<0?data.designs[index]:data.families[family];return <main style={{maxWidth:1440,margin:'auto',padding:28}}>
<h1 style={{fontSize:28}}>Formstead · Source plan variety</h1><p style={{margin:'12px 0'}}>One 40 × 60 m brief · 50 seed requests · {data.unique} distinct validated plans · every hard check passes</p>
<nav style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>{data.families.map((f,i)=><button onClick={()=>setFamily(i)} style={{padding:10,border:'1px solid #999'}}>{f.massingType}</button>)}<button onClick={()=>setFamily(-1)} style={{padding:10,border:'1px solid #999'}}>Seed gallery</button></nav>
{family<0&&<label>Requested seed <select value={index} onChange={e=>setIndex(+e.target.value)}>{data.summary.map((s,i)=><option value={i}>{s.requestedSeed} → plan seed {s.planSeed}</option>)}</select></label>}
<p style={{margin:'14px 0'}}>{d.massingType} · plan seed {d.planSeed} · covered {(100*d.coveredFootprintSqm/(40*60)).toFixed(1)}% · living {d.layoutChoices.living} · stair {d.layoutChoices.stair} · master {d.layoutChoices.master} · verandah {d.layoutChoices.verandah} · double height {d.layoutChoices.doubleHeight?'yes':'no'}</p>
<DrawingWorkspace design={d}/><h2 style={{margin:'30px 0',fontSize:24}}>50 ground-floor plans</h2><section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:18}}>{data.designs.map((p,i)=><button onClick={()=>{setFamily(-1);setIndex(i);window.scrollTo(0,0)}} style={{border:'1px solid #999',padding:10}}><p>Request {i+1} · plan {p.planSeed}</p><FloorDrawing floor={p.floors[0]} model={p.model} theme="paper" siteFeatures={p.siteFeatures}/></button>)}</section></main>};createRoot(document.getElementById('root')).render(<Review/>);`)
await writeFile(`${directory}/summary.json`,JSON.stringify({brief,unique,total:50,summary},null,2))
console.log(`Wing review: /${directory}/index.html · ${unique} distinct plans / 50 seed requests`)
