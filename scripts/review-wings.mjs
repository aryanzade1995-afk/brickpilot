import {mkdir,writeFile} from 'node:fs/promises'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {buildWingGallery,WING_GALLERY_SEEDS} from './wing-gallery-data.mjs'

const directory='output/wing-review'
await mkdir(`${directory}/families`,{recursive:true})
const brief=defaultBrief();brief.project.buildingType='large-villa';brief.site.plotWidth=40;brief.site.plotDepth=60
brief.rooms.bedroomsWithBath=2;brief.rooms.bedroomsNoBath=0
const families=buildWingGallery(brief)
const manifest={seedCount:WING_GALLERY_SEEDS,brief,families:families.map(({family,label,unique,summary})=>({family,label,unique,summary}))}
for(const family of families)await writeFile(`${directory}/families/${family.family}.json`,JSON.stringify(family))
await writeFile(`${directory}/manifest.json`,JSON.stringify(manifest))
await writeFile(`${directory}/summary.json`,JSON.stringify({...manifest,total:families.length*WING_GALLERY_SEEDS},null,2))
await writeFile(`${directory}/index.html`,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Formstead · 100-seed wing review</title></head><body><div id="root"></div><script type="module" src="./review.tsx"></script></body></html>')
await writeFile(`${directory}/review.tsx`, `import React,{useEffect,useMemo,useState} from 'react';import{createRoot}from'react-dom/client';
import{Canvas}from'@react-three/fiber';import{OrbitControls}from'@react-three/drei';
import{DrawingWorkspace}from'/src/components/DrawingWorkspace.tsx';import{FloorDrawing}from'/src/lib/draw/FloorDrawing.tsx';
import{BlenderVillaPanel}from'/src/components/BlenderVillaPanel.tsx';
import{buildMassing}from'/src/lib/three/buildMassing.ts';import{MassingModel,SceneEnv}from'/src/lib/three/MassingScene.tsx';
import'/src/index.css';import data from'./manifest.json';
const button='border border-line-strong px-4 py-2 text-sm hover:bg-bg-raised';
function Study({design}){const m=useMemo(()=>buildMassing(design),[design]),span=Math.max(m.bounds.w,m.bounds.d);return <div style={{height:650}} aria-label="Interactive wing geometry">
<Canvas key={design.id} shadows camera={{fov:37,near:.1,far:span*40,position:[span*1.1,span*.85,span*1.1]}}><SceneEnv massing={m}/><MassingModel massing={m} explode={0} hidden={new Set()} character={design.model.brief.style.character}/><OrbitControls target={m.center}/></Canvas></div>}
function Review(){const [index,setIndex]=useState(0),[family,setFamily]=useState('u-wing'),[pack,setPack]=useState(null),[error,setError]=useState(''),[view,setView]=useState('plan');
useEffect(()=>{let active=true;setPack(null);setError('');fetch('./families/'+family+'.json').then(r=>{if(!r.ok)throw new Error('Cannot load gallery');return r.json()}).then(p=>{if(active)setPack(p)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[family]);
const selected=data.families.find(f=>f.family===family),d=pack?.designs[index];return <main className="mx-auto max-w-[1440px] px-6 py-8">
<h1 className="font-display text-3xl">Formstead · 100-seed villa gallery</h1><p className="my-3 text-ink-dim">One 40 × 60 m brief · 100 seeds per family · 400 validated plans · {selected.unique} distinct {selected.label.toLowerCase()} plans</p>
<nav aria-label="Wing families" className="my-4 flex flex-wrap gap-2">{data.families.map(f=><button key={f.family} aria-pressed={family===f.family} className={button+(family===f.family?' bg-ink text-bg':'')} onClick={()=>{setFamily(f.family);setIndex(0)}}>{f.label}</button>)}</nav>
<div className="flex flex-wrap items-center gap-3"><label>Requested seed <select aria-label="Requested seed" className="border border-line-strong bg-bg px-3 py-2" value={index} onChange={e=>setIndex(+e.target.value)}>{selected.summary.map((s,i)=><option key={i} value={i}>{s.requestedSeed} → plan seed {s.planSeed}</option>)}</select></label><a className="underline" href="./summary.json">Validation summary</a><a className="underline" href="/workspace">Choose your villa</a></div>
<p className="my-3 text-xs text-ink-faint">A rejected candidate may resolve to a later passing seed. Distinct counts use room geometry, footprints and access, without colour or material differences.</p>
{error?<p role="alert">{error}</p>:!d?<p role="status">Loading validated plans…</p>:<><p className="my-4 text-sm">{selected.label} · plan seed {d.planSeed} · covered {(100*d.coveredFootprintSqm/2400).toFixed(1)}% · living {d.layoutChoices.living} · stair {d.layoutChoices.stair} · master {d.layoutChoices.master} · verandah {d.layoutChoices.verandah} · double height {d.layoutChoices.doubleHeight?'yes':'no'}</p>
<nav aria-label="Gallery views" className="mb-4 flex flex-wrap gap-2">{[['plan','2D plan'],['study','3D study'],['blender','Blender exterior']].map(([v,label])=><button key={v} className={button} aria-pressed={view===v} onClick={()=>setView(v)}>{label}</button>)}</nav>
{view==='plan'?<DrawingWorkspace key={d.id} design={d}/>:view==='study'?<Study design={d}/>:<BlenderVillaPanel key={d.id} plan={d} autoGenerate={false}/>}
<h2 className="my-8 font-display text-2xl">100 {selected.label.toLowerCase()} ground-floor plans</h2><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{pack.designs.map((p,i)=><button key={i} aria-label={'View seed '+(i+1)} onClick={()=>{setIndex(i);window.scrollTo({top:0,behavior:'smooth'})}} className="border border-line-strong p-3 text-left"><p className="mb-2 text-sm">Request {i+1} · plan {p.planSeed}</p><FloorDrawing floor={p.floors[0]} model={p.model} theme="paper" siteFeatures={p.siteFeatures}/></button>)}</section></>}
</main>};createRoot(document.getElementById('root')).render(<Review/>);`)
console.log(JSON.stringify({url:`/${directory}/index.html`,seedsPerFamily:WING_GALLERY_SEEDS,families:manifest.families.map(f=>({family:f.family,unique:f.unique}))},null,2))
