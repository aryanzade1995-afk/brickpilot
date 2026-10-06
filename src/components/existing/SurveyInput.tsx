import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button.tsx'
import { defaultPlot, emptySurvey, measuredStructure, scaleDrawing, surveySchema, SURVEY_DEFAULTS, withDefaults, type Survey } from '@/lib/existing/survey.ts'
import { useExisting } from '@/state/existing.ts'
import type { Answers } from '@/lib/existing/types.ts'

const input='w-full min-w-20 rounded border border-line bg-bg px-2 py-2 text-sm'
type Collection='columns'|'footings'|'beams'|'walls'|'rooms'|'openings'
// new rows start with standard sizes (editable), so a row is never left with a blank that blocks the plan
const D=SURVEY_DEFAULTS
const fresh={columns:{x:0,y:0,sizeMm:D.columnMm},footings:{x:0,y:0},beams:{a:0,b:1,widthMm:D.beamMm},walls:{a:{x:0,y:0},b:{x:0,y:0},thicknessMm:D.interiorWallMm,kind:'interior'},rooms:{name:'Room',type:'living',x:0,y:0,w:3,h:3},openings:{x:0,y:0,kind:'door',orient:'h',widthM:0.9,headM:D.doorHeadM,sillM:null,swing:1,leaf:true,emergencyExit:false}}

/** A drawing reader only proposes a tracing. User-confirmed measurements are the sole scale authority. */
export function SurveyInput({manual=false}:{manual?:boolean}) {
  const state=useExisting(), picker=useRef<HTMLInputElement>(null), request=useRef(0)
  useEffect(()=>()=>{request.current++},[])
  const [survey,setSurvey]=useState<Survey>(emptySurvey),[raw,setRaw]=useState<unknown>(null)
  const [image,setImage]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [overlay,setOverlay]=useState(true)
  const [width,setWidth]=useState(''),[depth,setDepth]=useState(''),[height,setHeight]=useState(String(SURVEY_DEFAULTS.heightM))
  const [summary,setSummary]=useState<string|null>(null)
  // where the house sits in the uploaded image (pixels), when the reader measured from the house outline
  const [source,setSource]=useState<{imageBox:[number,number,number,number];imageSize:[number,number]}|null>(null)
  const [plotWidth,setPlotWidth]=useState(''),[plotDepth,setPlotDepth]=useState('')
  const [confirmed,setConfirmed]=useState(false),[supportsChecked,setSupportsChecked]=useState(false)
  const [grid,setGrid]=useState({along:'',across:'',gapX:'',gapY:'',size:'',beamWidth:'',beams:false})
  const [planMode,setPlanMode]=useState<'foundation'|'house'>('foundation')
  const dirty=()=>setConfirmed(false)
  const patch=(next:Survey)=>{setSurvey(next);dirty()}
  const load=async(file:File)=>{
    const id=++request.current
    setError('');setBusy(true);setRaw(null);setSurvey(emptySurvey());setWidth('');setDepth('');setHeight(String(SURVEY_DEFAULTS.heightM));setConfirmed(false);setSupportsChecked(false);setSummary(null);setSource(null)
    try {
      if(file.size>5e6||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPEG or WebP drawing under 5 MB.')
      const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error('The drawing could not be opened.'));r.readAsDataURL(file)})
      if(id!==request.current)return
      setImage(data)
      const response=await fetch('/api/existing-plan/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({imageBase64:data.split(',')[1],mimeType:file.type}),signal:AbortSignal.timeout(300000)})
      const result=await response.json()
      if(!response.ok)throw new Error(result.error??'The drawing reader is unavailable.')
      const draft=surveySchema.parse(result.draft)
      setSource(result.draft?.source?.imageBox?result.draft.source:null)
      if(id!==request.current)return
      setRaw(draft);setWidth(draft.widthM?.toString()??'');setDepth(draft.depthM?.toString()??'');setHeight(String(draft.heightM??SURVEY_DEFAULTS.heightM))
      setPlanMode(draft.rooms.length?'house':'foundation')
      if(draft.widthM&&draft.depthM){
        // a complete, valid starting point: standard sizes in every blank, a plot that fits with the usual setbacks
        const filled=withDefaults(scaleDrawing(draft,draft.widthM,draft.depthM)), plot=defaultPlot(draft.widthM,draft.depthM)
        setSurvey(filled);setPlotWidth(String(plot.widthM));setPlotDepth(String(plot.depthM))
        if(draft.rooms.length){state.setAnswer('storeysWanted',1);state.setAnswer('storeysBuilt',1)}
        setSupportsChecked(true);setConfirmed(true)
        setSummary(`Read ${filled.rooms.length} rooms, ${filled.openings.filter(o=>o.kind!=='window').length} doors and openings and ${filled.openings.filter(o=>o.kind==='window').length} windows; the house is ${draft.widthM.toFixed(2)} × ${draft.depthM.toFixed(2)} m. Standard sizes are filled in where the drawing shows none: ${SURVEY_DEFAULTS.heightM} m floor height, ${SURVEY_DEFAULTS.exteriorWallMm}/${SURVEY_DEFAULTS.interiorWallMm} mm walls, ${SURVEY_DEFAULTS.columnMm} mm columns at the wall corners, ${SURVEY_DEFAULTS.doorHeadM} m door heads, ${SURVEY_DEFAULTS.windowSillM} m window sills. Change anything that differs on site.`)
      }
    } catch(e){if(id===request.current)setError(e instanceof Error?e.message:'The drawing could not be read. Enter the measurements manually.')}
    finally {if(id===request.current)setBusy(false)}
  }
  const applyScale=()=>{
    try {setError('');const scaled=withDefaults(scaleDrawing(raw,Number(width),Number(depth)));patch({...scaled,plotOffsetXM:survey.plotOffsetXM??scaled.plotOffsetXM,plotOffsetYM:survey.plotOffsetYM??scaled.plotOffsetYM})}catch(e){setError(e instanceof Error?e.message:'Enter both measured drawing dimensions.')}
  }
  const cell=(label:string,value: string|number|null,change:(n:number)=>void,zeroBased=false)=><label className="block text-xs text-ink-dim">{label}<input className={input} type="number" min="0" step={zeroBased?'1':'any'} value={value===null||typeof value==='number'&&!Number.isFinite(value)?'':zeroBased?Number(value)+1:value} onChange={e=>{const n=e.target.value===''?NaN:Number(e.target.value);change(zeroBased?n-1:n)}} /></label>
  const field=(label:string,value:string,set:(s:string)=>void)=><label className="block text-xs text-ink-dim">{label}<input className={input} type="number" min="0" step="any" value={value} onChange={e=>{set(e.target.value);dirty()}} /></label>
  const update=(key:Collection,i:number,record:unknown)=>patch({...survey,[key]:survey[key].map((r,j)=>j===i?record:r)} as Survey)
  const remove=(key:Collection,i:number)=>{
    if(key==='columns')patch({...survey,columns:survey.columns.filter((_,j)=>j!==i),beams:survey.beams.filter(b=>b.a!==i&&b.b!==i).map(b=>({...b,a:b.a>i?b.a-1:b.a,b:b.b>i?b.b-1:b.b}))})
    else patch({...survey,[key]:survey[key].filter((_,j)=>j!==i)} as Survey)
  }
  const section=(key:Collection,title:string,rows:React.ReactNode)=><section className="mt-5 rounded border border-line p-4"><div className="flex justify-between gap-3"><h3 className="text-sm font-medium">{title} ({survey[key].length})</h3><button type="button" className="text-xs underline" onClick={()=>patch({...survey,[key]:[...survey[key],structuredClone(fresh[key])]} as Survey)}>Add {title.toLowerCase().replace(/s$/,'')}</button></div>{rows}</section>
  const row=(key:Collection,i:number,children:React.ReactNode)=><div key={i} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"><span className="pb-2 text-xs">{i+1}</span>{children}<button type="button" className="p-2 text-xs underline" aria-label={`Remove ${key} ${i+1}`} onClick={()=>remove(key,i)}>Remove</button></div>
  const build=()=>{
    setError('')
    try {
      if(!supportsChecked)throw new Error('Confirm whether the drawing includes every existing column and footing. Add missing positions manually first.')
      if(raw && (survey.widthM!==Number(width)||survey.depthM!==Number(depth)))throw new Error('Apply the measured image scale before confirming. Reapplying scale replaces coordinate corrections.')
      if(planMode==='house'&&!survey.rooms.length)throw new Error('Add the rooms shown in the house plan before continuing.')
      // blanks take the standard values: floor height, a plot sized with the usual setbacks, wall/column/opening sizes
      const h=Number(height)||SURVEY_DEFAULTS.heightM, plot=Number(width)&&Number(depth)?defaultPlot(Number(width),Number(depth)):null
      const answers:Answers={...state.answers,plotWidthM:Number(plotWidth)||plot?.widthM||NaN,plotDepthM:Number(plotDepth)||plot?.depthM||NaN,floorHeightM:h}
      const selected=withDefaults({...survey,widthM:Number(width)||null,depthM:Number(depth)||null,heightM:h,...(planMode==='foundation'?{rooms:[],openings:[]}: {})})
      const built=measuredStructure(selected,answers,confirmed)
      if(built.structure.measuredPlan){
        const {rooms,openings}=built.structure.measuredPlan
        const bedrooms=rooms.filter(r=>r.zone==='private'),baths=rooms.filter(r=>r.id.startsWith('bath'))
        const attached=new Set<string>()
        for(const o of openings.filter(o=>o.kind==='door'))if(o.rooms?.some(id=>bedrooms.some(r=>r.id===id)))for(const id of o.rooms??[])if(baths.some(r=>r.id===id))attached.add(id!)
        answers.bedroomsWithBath=bedrooms.filter(r=>openings.some(o=>o.kind==='door'&&o.rooms?.includes(r.id)&&o.rooms.some(id=>id!==null&&attached.has(id)))).length
        answers.bedroomsNoBath=bedrooms.length-answers.bedroomsWithBath
        answers.sharedBaths=baths.length-attached.size;answers.studies=rooms.filter(r=>r.zone==='work').length
        answers.parking=false;answers.pooja=rooms.some(r=>r.zone==='sacred');answers.utility=rooms.some(r=>r.id==='utility')
      }
      state.acceptMeasured({ok:true,value:built},answers)
    }catch(e){setError(e instanceof Error?e.message:'Check the measurements.')}
  }
  const applyGrid=()=>{
    try {
      const along=Number(grid.along),across=Number(grid.across),gapX=Number(grid.gapX),gapY=Number(grid.gapY),size=Number(grid.size)
      if(!Number.isInteger(along)||!Number.isInteger(across)||along<2||across<2||along*across>150||!(gapX>0&&gapY>0)||size<100||size>1500)throw new Error('Enter column counts of at least 2, positive measured gaps, and the measured square column size (100–1500 mm).')
      if(grid.beams&&!(Number(grid.beamWidth)>=100&&Number(grid.beamWidth)<=1500))throw new Error('Enter the measured beam width for the existing grid connections.')
      const columns=Array.from({length:along*across},(_,i)=>({x:i%along*gapX,y:Math.floor(i/along)*gapY,sizeMm:size})),beams:Survey['beams']=[]
      if(grid.beams)for(let i=0;i<columns.length;i++){if(i%along<along-1)beams.push({a:i,b:i+1,widthMm:Number(grid.beamWidth)});if(i+along<columns.length)beams.push({a:i,b:i+along,widthMm:Number(grid.beamWidth)})}
      patch({...survey,columns,beams});setSupportsChecked(false);setError('')
      if(!width)setWidth(String((along-1)*gapX));if(!depth)setDepth(String((across-1)*gapY))
    }catch(e){setError(e instanceof Error?e.message:'Check the measured grid.')}
  }
  const W=Number(width)||1,D=Number(depth)||1
  const pointReady=(p:{x:number;y:number})=>Number.isFinite(p.x+p.y)
  return <div className="space-y-5" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-2xl">{manual?'Enter the existing structure':'Read and review your drawing'}</h2><p className="mt-2 text-sm text-ink-dim">All positions are measured in metres from the drawing’s top-left corner. Align the drawing with the road/entrance at the bottom. Unknown sizes stay blank.</p></div>{!manual&&<Button disabled={busy} onClick={()=>picker.current?.click()}>Choose plan image</Button>}<input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void load(f)}} /></div>
    {busy&&<p role="status" className="text-sm">Reading the drawing on this computer (about a minute)… the rooms, walls, doors, windows and size are traced, then you can check them.</p>}
    {summary&&!busy&&<div role="status" className="flex flex-wrap items-center gap-4 border-l-2 border-ok bg-ok/5 p-4 text-sm"><p className="min-w-0 flex-1">{summary}</p><Button onClick={()=>build()}>Build the 2D plan</Button></div>}
    <fieldset disabled={busy}>
    {error&&<p role="alert" className="border-l-2 border-bad bg-bad/5 p-3 text-sm">{error}</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        {image&&<img src={image} alt="Uploaded house or foundation drawing" className="max-h-96 w-full border border-line object-contain" />}
        <div className="rounded border border-line p-3"><p className="mb-2 text-xs">Measured tracing — check against the original drawing</p><svg viewBox={`-0.5 -0.5 ${W+1} ${D+1}`} className="max-h-96 w-full bg-white" role="img" aria-label="Measured structure review">
          {image&&overlay&&(()=>{
            if(!source)return <image href={image} width={W} height={D} opacity="0.35" preserveAspectRatio="none" />
            const [x0,y0,x1,y1]=source.imageBox,kx=W/(x1-x0),ky=D/(y1-y0)
            return <image href={image} x={-x0*kx} y={-y0*ky} width={source.imageSize[0]*kx} height={source.imageSize[1]*ky} opacity="0.35" preserveAspectRatio="none" />
          })()}
          <rect width={W} height={D} fill="none" stroke="#888" strokeWidth="0.03" />
          {survey.rooms.map((r,i)=>pointReady(r)&&Number.isFinite(r.w+r.h)?<g key={`r${i}`}><rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#eee" fillOpacity="0.4" stroke="#aaa" strokeWidth="0.025" /><text x={r.x+r.w/2} y={r.y+r.h/2} fontSize="0.18" textAnchor="middle">{r.name}</text></g>:null)}
          {survey.walls.map((w,i)=>pointReady(w.a)&&pointReady(w.b)?<line key={`w${i}`} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#222" strokeWidth={(w.thicknessMm??50)/1000} />:null)}
          {survey.beams.map((b,i)=>{const a=survey.columns[b.a],c=survey.columns[b.b];return a&&c&&pointReady(a)&&pointReady(c)?<line key={`b${i}`} x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke="#777" strokeWidth="0.05" strokeDasharray="0.1 0.1" />:null})}
          {survey.footings.map((f,i)=>pointReady(f)?<rect key={`f${i}`} x={f.x-.12} y={f.y-.12} width="0.24" height="0.24" fill="none" stroke="#995511" strokeWidth="0.04" />:null)}
          {survey.columns.map((c,i)=>pointReady(c)?<g key={`c${i}`}><rect x={c.x-(c.sizeMm??150)/2000} y={c.y-(c.sizeMm??150)/2000} width={(c.sizeMm??150)/1000} height={(c.sizeMm??150)/1000} fill="#222"/><text x={c.x+.14} y={c.y-.12} fontSize="0.22">C{i+1}</text></g>:null)}
          {survey.openings.map((o,i)=>pointReady(o)?<line key={`o${i}`} x1={o.x-(o.orient==='h'?(o.widthM??.2)/2:0)} y1={o.y-(o.orient==='v'?(o.widthM??.2)/2:0)} x2={o.x+(o.orient==='h'?(o.widthM??.2)/2:0)} y2={o.y+(o.orient==='v'?(o.widthM??.2)/2:0)} stroke={o.kind==='window'?'#287ab0':'#d77d22'} strokeWidth="0.1" />:null)}
        </svg><p className="text-xs text-ink-dim">Black: columns/walls · dashed: beams · brown: footings · blue: windows · orange: doors. Blank sizes use a marker for review only.</p></div>
        {image&&<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={overlay} onChange={e=>setOverlay(e.target.checked)} />Overlay original drawing on the tracing</label>}
        {survey.notes.map((n,i)=><p key={i} className="text-xs text-ink-dim">{n}</p>)}
      </div>
      <div className="space-y-4">
        <label className="block text-sm">What does this drawing describe?<select className={input} value={planMode} onChange={e=>{setPlanMode(e.target.value as typeof planMode);dirty()}}><option value="foundation">Foundation / columns — plan rooms around it</option><option value="house">House layout — preserve traced rooms, walls and openings</option></select></label>
        <div className="grid grid-cols-2 gap-3">{field(source?'House width, outer wall to outer wall centre (m)':image?'Entire image width (m)':'Structure width (m)',width,setWidth)}{field(source?'House depth (m)':image?'Entire image depth (m)':'Structure depth (m)',depth,setDepth)}{field('Plot width (m)',plotWidth,setPlotWidth)}{field('Plot depth (m)',plotDepth,setPlotDepth)}{field('Floor-to-floor height (m)',height,setHeight)}</div>
        <div className="grid grid-cols-2 gap-3">{cell('Drawing origin from plot left edge (m)',survey.plotOffsetXM,n=>patch({...survey,plotOffsetXM:Number.isFinite(n)?n:null}))}{cell('Drawing origin from plot rear edge (m)',survey.plotOffsetYM,n=>patch({...survey,plotOffsetYM:Number.isFinite(n)?n:null}))}</div>
        <label className="block text-xs">Road / entrance compass side<select className={input} value={state.answers.roadSide} onChange={e=>{state.setAnswer('roadSide',e.target.value as Answers['roadSide']);dirty()}}>{['N','E','S','W'].map(d=><option key={d}>{d}</option>)}</select></label>
        {raw!==null&&<><p className="text-xs text-ink-dim">Use the width and depth spanning the whole image. Crop margins before uploading if the labels measure only the building. Apply scale before editing the coordinates.</p><Button variant="ghost" onClick={applyScale}>Apply measured image scale</Button></>}
        <div className="grid grid-cols-2 gap-3"><label className="text-xs">Floors already built<select className={input} value={state.answers.storeysBuilt} onChange={e=>{state.setAnswer('storeysBuilt',Number(e.target.value));dirty()}}>{[0,1,2,3].map(n=><option key={n} value={n}>{n===0?'Foundation only':n}</option>)}</select></label><label className="text-xs">Floors wanted<select className={input} value={state.answers.storeysWanted} onChange={e=>{state.setAnswer('storeysWanted',Number(e.target.value));dirty()}}>{[1,2,3].map(n=><option key={n} value={n}>{n}</option>)}</select></label></div>
        <p className="text-xs text-ink-dim">For a house layout, import one measured ground floor with rectangular room sections and straight walls. Additional floors require their own plans and stairs; they are not inferred.</p>
        {planMode==='foundation'&&<div className="grid grid-cols-2 gap-3">{(['bedroomsWithBath','bedroomsNoBath','sharedBaths','studies'] as const).map(k=><label key={k} className="text-xs">{{bedroomsWithBath:'Bedrooms with bath',bedroomsNoBath:'Bedrooms without bath',sharedBaths:'Shared bathrooms',studies:'Studies'}[k]}<input type="number" className={input} min="0" max="8" value={state.answers[k]} onChange={e=>{state.setAnswer(k,Number(e.target.value));dirty()}} /></label>)}</div>}
        {planMode==='foundation'&&<div className="flex flex-wrap gap-3">{([['parking','Covered parking'],['utility','Utility room'],['pooja','Pooja room']] as const).map(([key,label])=><label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={state.answers[key]} onChange={e=>{state.setAnswer(key,e.target.checked);dirty()}} />{label}</label>)}</div>}
      </div>
    </div>
    <details className="mt-5 rounded border border-line p-4"><summary className="cursor-pointer text-sm">Shortcut: enter a regular column grid</summary><p className="mt-3 text-xs text-ink-dim">Use only when the existing columns form this measured grid. Applying it replaces the column list and beam connections; individual positions remain editable.</p><div className="mt-3 grid grid-cols-2 gap-3">{(['along','across','gapX','gapY','size'] as const).map(k=><span key={k}>{field(({along:'Columns along length',across:'Columns across depth',gapX:'Gap along length (m)',gapY:'Gap across depth (m)',size:'Square column size (mm)'})[k],grid[k],value=>setGrid({...grid,[k]:value}))}</span>)}</div><label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={grid.beams} onChange={e=>setGrid({...grid,beams:e.target.checked})} />Existing beams connect all adjacent columns in both directions</label>{grid.beams&&field('Grid beam width (mm)',grid.beamWidth,value=>setGrid({...grid,beamWidth:value}))}<Button variant="ghost" onClick={applyGrid}>Apply measured grid</Button></details>
    {section('columns','Columns',survey.columns.map((c,i)=>row('columns',i,<>{cell('X (m)',c.x,n=>update('columns',i,{...c,x:n}))}{cell('Y (m)',c.y,n=>update('columns',i,{...c,y:n}))}{cell('Square size (mm)',c.sizeMm,n=>update('columns',i,{...c,sizeMm:Number.isFinite(n)?n:null}))}</>)))}
    {section('footings','Footings',survey.footings.map((f,i)=>row('footings',i,<>{cell('X (m)',f.x,n=>update('footings',i,{...f,x:n}))}{cell('Y (m)',f.y,n=>update('footings',i,{...f,y:n}))}</>)))}
    {section('beams','Beams',survey.beams.map((b,i)=>row('beams',i,<>{cell('From column number',b.a,n=>update('beams',i,{...b,a:n}),true)}{cell('To column number',b.b,n=>update('beams',i,{...b,b:n}),true)}{cell('Width (mm)',b.widthMm,n=>update('beams',i,{...b,widthMm:Number.isFinite(n)?n:null}))}</>)))}
    {section('walls','Walls',survey.walls.map((w,i)=>row('walls',i,<>{(['a','b'] as const).flatMap(end=>(['x','y'] as const).map(axis=><span key={end+axis}>{cell(`${end==='a'?'Start':'End'} ${axis.toUpperCase()} (m)`,w[end][axis],n=>update('walls',i,{...w,[end]:{...w[end],[axis]:n}}))}</span>))}{cell('Thickness (mm)',w.thicknessMm,n=>update('walls',i,{...w,thicknessMm:Number.isFinite(n)?n:null}))}<label className="text-xs">Wall type<select className={input} value={w.kind} onChange={e=>update('walls',i,{...w,kind:e.target.value})}><option value="exterior">Exterior</option><option value="interior">Interior</option></select></label></>)))}
    {planMode==='house'&&<>
      {section('rooms','Rooms',survey.rooms.map((r,i)=>row('rooms',i,<><label className="text-xs">Room name<input className={input} value={r.name} onChange={e=>update('rooms',i,{...r,name:e.target.value})} /></label><label className="text-xs">Type<select className={input} value={r.type} onChange={e=>update('rooms',i,{...r,type:e.target.value})}>{['living','livingDining','dining','kitchen','bed','bath','study','pooja','utility','corridor','foyer','stair'].map(t=><option key={t} value={t}>{t==='bed'?'Bedroom':t==='bath'?'Bathroom':t}</option>)}</select></label>{r.type==='stair'&&<label className="text-xs">Stair starts on<select className={input} value={r.stairStartSide??''} onChange={e=>update('rooms',i,{...r,stairStartSide:e.target.value||null})}><option value="">Choose side</option>{['N','S','E','W'].map(side=><option key={side}>{side}</option>)}</select></label>}{(['x','y','w','h'] as const).map(k=><span key={k}>{cell(({x:'X',y:'Y',w:'Width',h:'Depth'})[k]+' (m)',r[k],n=>update('rooms',i,{...r,[k]:n}))}</span>)}</>)))}
      {section('openings','Doors and windows',survey.openings.map((o,i)=>row('openings',i,<>{cell('Centre X (m)',o.x,n=>update('openings',i,{...o,x:n}))}{cell('Centre Y (m)',o.y,n=>update('openings',i,{...o,y:n}))}{cell('Width (m)',o.widthM,n=>update('openings',i,{...o,widthM:Number.isFinite(n)?n:null}))}{cell('Head height (m)',o.headM,n=>update('openings',i,{...o,headM:Number.isFinite(n)?n:null}))}{o.kind==='window'&&cell('Sill height (m)',o.sillM,n=>update('openings',i,{...o,sillM:Number.isFinite(n)?n:null}))}<label className="text-xs">Type<select className={input} value={o.kind} onChange={e=>update('openings',i,{...o,kind:e.target.value})}><option value="door">Door</option><option value="window">Window</option><option value="entry">Entry (outside door)</option></select></label>{o.kind!=='window'&&<><label className="text-xs">Door opens toward<select className={input} value={o.swing} onChange={e=>update('openings',i,{...o,swing:Number(e.target.value)})}><option value={1}>Right / bottom of drawing</option><option value={-1}>Left / top of drawing</option></select></label><label className="text-xs"><input type="checkbox" checked={o.leaf} onChange={e=>update('openings',i,{...o,leaf:e.target.checked})} /> Has door leaf</label>{o.kind==='entry'&&<label className="text-xs"><input type="checkbox" checked={o.emergencyExit} onChange={e=>update('openings',i,{...o,emergencyExit:e.target.checked})} /> Secondary emergency exit</label>}</>}<label className="text-xs">Wall direction<select className={input} value={o.orient} onChange={e=>update('openings',i,{...o,orient:e.target.value})}><option value="h">Horizontal</option><option value="v">Vertical</option></select></label></>)))}
    </>}
    <div className="space-y-3 border-t border-line pt-5"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={supportsChecked} onChange={e=>{setSupportsChecked(e.target.checked);dirty()}} />I have entered every existing column and footing, including those missing from the drawing.</label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />I checked the dimensions, floor height, beam connections, room boundaries, walls and opening positions against the site measurements.</label><Button disabled={busy} onClick={build}>Confirm and validate 2D plan</Button><p className="text-xs text-ink-dim">The normal checks run before 3D, interiors and cost. Unknown measurements cannot be guessed or skipped.</p></div>
    </fieldset>
  </div>
}
