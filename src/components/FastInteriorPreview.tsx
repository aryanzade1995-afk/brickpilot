import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useTexture } from '@react-three/drei'
import { BackSide, SRGBColorSpace, PerspectiveCamera } from 'three'
import type { Design } from '@/lib/engine/types.ts'
import { previewRooms, defaultConfiguration, INTERIOR_STYLES, FLOORINGS, CEILINGS, LIGHTINGS, DENSITIES, WALL_PRESETS, type InteriorConfiguration, type Quality } from '@/lib/interior/preview.ts'

function Panorama({ url, fov }: {url:string;fov:number}) {
  const texture=useTexture(url, texture=>{if('colorSpace' in texture)texture.colorSpace=SRGBColorSpace})
  const camera=useThree(s=>s.camera)
  useEffect(()=>{if(camera instanceof PerspectiveCamera){camera.fov=fov;camera.updateProjectionMatrix()}},[camera,fov])
  return <><mesh scale={[-1,1,1]} rotation={[0,-Math.PI/2,0]}><sphereGeometry args={[10,64,32]} /><meshBasicMaterial map={texture} side={BackSide} /></mesh><OrbitControls enablePan={false} enableZoom={false} rotateSpeed={-0.4} target={[0,0,0]} /></>
}
export function FastInteriorPreview({design}: {design:Design}) {
  const rooms=useMemo(()=>previewRooms(design),[design])
  const [config,setConfig]=useState<InteriorConfiguration>(()=>defaultConfiguration(rooms[0]?.id??'',rooms[0]?.floor??0))
  const [quality,setQuality]=useState<Quality>('fast')
  const [busy,setBusy]=useState(false), [error,setError]=useState('')
  const [stage,setStage]=useState('Preparing selected room'), [fov,setFov]=useState(75), [fullscreen,setFullscreen]=useState(false)
  const viewer=useRef<HTMLDivElement>(null), panel=useRef<HTMLDivElement>(null), pinch=useRef<number|null>(null)
  useEffect(()=>{const change=()=>setFullscreen(document.fullscreenElement===viewer.current);document.addEventListener('fullscreenchange',change);return()=>document.removeEventListener('fullscreenchange',change)},[])
  const [result,setResult]=useState<{url:string;initialYaw:number;cached:boolean}|null>(null)
  useEffect(()=>{const element=viewer.current;if(!element || !result)return;const zoom=(e:WheelEvent)=>{e.preventDefault();setFov(f=>Math.max(35,Math.min(100,f+e.deltaY*0.04)))};element.addEventListener('wheel',zoom,{passive:false});return()=>element.removeEventListener('wheel',zoom)},[result])
  useEffect(()=> { setResult(null);setError('') },[config,quality,design])
  useEffect(()=> { if(!rooms.some(r=>r.id===config.roomId && r.floor===config.floor) && rooms.length) setConfig(defaultConfiguration(rooms[0].id,rooms[0].floor)) },[rooms,config.roomId,config.floor])
  const update=(patch:Partial<InteriorConfiguration>)=>setConfig(c=>({...c,...patch}))
  const select=(label:string,value:string,list:readonly {id:string;label:string}[],change:(value:string)=>void)=><label className="block text-sm">{label}<select disabled={busy} className="mt-1 w-full border border-line bg-bg p-2" value={value} onChange={e=>change(e.target.value)}>{list.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
  const run=async()=> {
    setBusy(true);setError('');setResult(null);setStage('Preparing selected room');setFov(75)
    const requestId=crypto.randomUUID()
    const progress=setInterval(()=>{fetch(`/api/interior-preview/status/${requestId}`).then(r=>r.json()).then(data=>setStage(data.stage)).catch(()=>{})},1000)
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),610_000)
    try {
      const response=await fetch('/api/interior-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({design,config,quality,requestId}),signal:controller.signal})
      const data=await response.json()
      if(!response.ok) throw new Error(data.error || 'Preview unavailable.')
      setResult(data)
    } catch(e) {setError(e instanceof Error?e.message:'Preview unavailable. Please retry.')}
    finally {clearTimeout(timer);clearInterval(progress);setBusy(false)}
  }
  const room=rooms.find(r=>r.id===config.roomId && r.floor===config.floor)
  return <section className="border border-line p-5 mt-6" aria-label="Fast 360 interior preview">
    <h2 className="font-display text-2xl">Fast 360° Interior Preview</h2>
    <p className="mt-2 text-sm text-ink-dim">Customize the selected room from your validated plan. Drag the finished panorama to look around.</p>
    <div className="mt-5 grid gap-6 lg:grid-cols-[300px_1fr]">
      <div ref={panel} className="space-y-3">
        {select('Floor',String(config.floor),[...new Set(rooms.map(r=>r.floor))].map(f=>({id:String(f),label:rooms.find(r=>r.floor===f)!.floorName})),v=>{const r=rooms.find(r=>r.floor===Number(v))!;update({floor:r.floor,roomId:r.id})})}
        {select('Room',config.roomId,rooms.filter(r=>r.floor===config.floor).map(r=>({id:r.id,label:r.name})),v=>update({roomId:v}))}
        {select('Interior style',config.style,INTERIOR_STYLES,v=>update({style:v as InteriorConfiguration['style']}))}
        {select('Flooring',config.flooring.material,FLOORINGS,v=>update({flooring:{material:v as InteriorConfiguration['flooring']['material'],color:FLOORINGS.find(o=>o.id===v)!.color}}))}
        <label className="block text-sm">Flooring colour <input disabled={busy} aria-label="Flooring colour" type="color" value={config.flooring.color} onChange={e=>update({flooring:{...config.flooring,color:e.target.value}})} /></label>
        <label className="block text-sm">Wall colour <input disabled={busy} aria-label="Wall colour" type="color" value={config.walls.color} onChange={e=>update({walls:{color:e.target.value}})} /></label>
        <div className="flex gap-2 flex-wrap">{WALL_PRESETS.map(p=><button disabled={busy} key={p.color} title={p.label} aria-label={p.label} className="h-6 w-6 border border-line" style={{background:p.color}} onClick={()=>update({walls:{color:p.color}})} />)}</div>
        {select('Ceiling',config.ceiling.type,CEILINGS,v=>update({ceiling:{...config.ceiling,type:v as InteriorConfiguration['ceiling']['type']}}))}
        <label className="block text-sm">Ceiling colour <input disabled={busy} aria-label="Ceiling colour" type="color" value={config.ceiling.color} onChange={e=>update({ceiling:{...config.ceiling,color:e.target.value}})} /></label>
        {select('Lighting',config.lighting,LIGHTINGS,v=>update({lighting:v as InteriorConfiguration['lighting']}))}
        {select('Furniture density',config.furnitureDensity,DENSITIES,v=>update({furnitureDensity:v as InteriorConfiguration['furnitureDensity']}))}
        {select('Quality',quality,[{id:'fast',label:'Fast · 2048 × 1024'},{id:'high',label:'High · 4096 × 2048'}],v=>setQuality(v as Quality))}
        <button disabled={busy || !room} onClick={run} className="w-full bg-accent p-3 text-white disabled:opacity-50">{busy?'Rendering selected room…':'Generate Fast Preview'}</button>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      </div>
      <div className="min-w-0">
        <p className="mb-3 text-sm text-ink-dim">{room?.name} · {room?.w.toFixed(2)} × {room?.d.toFixed(2)} m</p>
        <div ref={viewer} className="bg-bg" style={{height:fullscreen?'100vh':520,position:fullscreen?'fixed':'relative',inset:fullscreen?0:undefined,zIndex:fullscreen?1000:undefined,touchAction:'none'}} aria-label="Interactive 360 panorama"
          onTouchStart={e=>{if(e.touches.length===2)pinch.current=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY)}}
          onTouchMove={e=>{if(e.touches.length===2 && pinch.current!==null){const distance=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);setFov(f=>Math.max(35,Math.min(100,f+(pinch.current!-distance)*0.15)));pinch.current=distance}}}
          onTouchEnd={()=>{pinch.current=null}}>
          {result?<Suspense fallback={<p className="p-5">Loading panorama…</p>}><Canvas key={result.url} camera={{position:[-Math.sin(result.initialYaw*Math.PI/180)*0.01,0,Math.cos(result.initialYaw*Math.PI/180)*0.01],fov:75}}><Panorama url={result.url} fov={fov} /></Canvas></Suspense>:<p role="status" className="p-6 text-ink-dim">{busy?stage:'Choose finishes and generate your 360° room.'}</p>}
          {result && <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-2 text-sm"><button className="bg-bg border border-line px-3 py-2" onClick={()=>setFov(f=>Math.max(35,f-10))} aria-label="Zoom in">+</button><button className="bg-bg border border-line px-3 py-2" onClick={()=>setFov(f=>Math.min(100,f+10))} aria-label="Zoom out">−</button><button className="bg-bg border border-line px-3 py-2" onClick={async()=>{if(fullscreen){if(document.fullscreenElement)await document.exitFullscreen();else setFullscreen(false)}else{setFullscreen(true);try{await viewer.current?.requestFullscreen()}catch{/* Embedded browsers use the full-window overlay. */}}}}>{fullscreen?'Exit full screen':'Full screen'}</button></div>}
        </div>
        {result && <p className="mt-3 text-sm">{result.cached?'Loaded saved preview.':'Preview ready.'} <a className="underline" href={result.url} download="interior-360.webp">Download panorama</a></p>}
        {result && <div className="mt-3 flex gap-3 text-sm"><button onClick={run} className="border border-line p-2">Render again</button><button className="border border-line p-2" onClick={()=>{panel.current?.scrollIntoView({behavior:'smooth'});panel.current?.querySelector('select')?.focus()}}>Change materials</button><span className="p-2 text-ink-dim">Drag to look around · scroll or pinch to zoom</span></div>}
      </div>
    </div>
  </section>
}


