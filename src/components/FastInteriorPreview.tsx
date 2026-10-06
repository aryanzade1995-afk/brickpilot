import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useTexture } from '@react-three/drei'
import { BackSide, SRGBColorSpace, PerspectiveCamera } from 'three'
import type { Design } from '@/lib/engine/types.ts'
import { previewRooms, defaultConfiguration, INTERIOR_STYLES, LIGHTINGS, DENSITIES, type InteriorConfiguration, type Quality } from '@/lib/interior/preview.ts'
import { interiorFinishes } from '@/lib/interior/finishes.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'
import { useInterior360 } from '@/state/interior360.ts'

function Panorama({ url, fov }: {url:string;fov:number}) {
  const texture=useTexture(url, texture=>{if('colorSpace' in texture)texture.colorSpace=SRGBColorSpace})
  const camera=useThree(s=>s.camera), invalidate=useThree(s=>s.invalidate)
  useEffect(()=>{if(camera instanceof PerspectiveCamera){camera.fov=fov;camera.updateProjectionMatrix();invalidate()}},[camera,fov,invalidate])
  return <><mesh scale={[-1,1,1]} rotation={[0,-Math.PI/2,0]}><sphereGeometry args={[10,64,32]} /><meshBasicMaterial map={texture} side={BackSide} /></mesh><OrbitControls enablePan={false} enableZoom={false} rotateSpeed={-0.4} target={[0,0,0]} /></>
}

/** Fast 360 preview of one room, dressed in exactly what was chosen on Finishes & Cost. */
export function FastInteriorPreview({design}: {design:Design}) {
  const rooms=useMemo(()=>previewRooms(design),[design])
  const store=useInterior360()
  const room=rooms.find(r=>r.id===store.room?.roomId && r.floor===store.room?.floor) ?? rooms[0]
  const config: InteriorConfiguration = useMemo(()=>({...defaultConfiguration(room?.id??'',room?.floor??0),
    style:store.style as InteriorConfiguration['style'], lighting:store.lighting as InteriorConfiguration['lighting'], furnitureDensity:store.furnitureDensity as InteriorConfiguration['furnitureDensity']}),
    [room?.id,room?.floor,store.style,store.lighting,store.furnitureDensity])
  const finishes=useMemo(()=>room?interiorFinishes(design,room.floor,room.id):null,[design,room?.id,room?.floor]) // eslint-disable-line react-hooks/exhaustive-deps
  const designId=useMemo(()=>createBuildingModel(design).planId,[design])
  // one saved preview per room, style, lighting, furniture, quality and finishes: change any finish and it is made again
  const savedKey=useMemo(()=>JSON.stringify([designId,config.floor,config.roomId,config.style,config.lighting,config.furnitureDensity,store.quality,finishes?.summary.map(s=>`${s.label}=${s.value}`)]),[designId,config,store.quality,finishes])
  const saved=store.saved[savedKey]
  const [busy,setBusy]=useState(false), [error,setError]=useState('')
  const [stage,setStage]=useState('Preparing selected room'), [fov,setFov]=useState(75), [fullscreen,setFullscreen]=useState(false)
  const viewer=useRef<HTMLDivElement>(null), panel=useRef<HTMLDivElement>(null), pinch=useRef<number|null>(null)
  const [fresh,setFresh]=useState(false)
  useEffect(()=>{const change=()=>setFullscreen(document.fullscreenElement===viewer.current);document.addEventListener('fullscreenchange',change);return()=>document.removeEventListener('fullscreenchange',change)},[])
  const result=saved?{url:saved.url,initialYaw:saved.initialYaw}:null
  useEffect(()=>{const element=viewer.current;if(!element || !result)return;const zoom=(e:WheelEvent)=>{e.preventDefault();setFov(f=>Math.max(35,Math.min(100,f+e.deltaY*0.04)))};element.addEventListener('wheel',zoom,{passive:false});return()=>element.removeEventListener('wheel',zoom)},[result])
  useEffect(()=>{setError('');setFresh(false)},[savedKey])
  const select=(label:string,value:string,list:readonly {id:string;label:string}[],change:(value:string)=>void)=><label className="block text-sm">{label}<select disabled={busy} className="mt-1 w-full border border-line bg-bg p-2" value={value} onChange={e=>change(e.target.value)}>{list.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
  const run=async()=> {
    if(!room)return
    setBusy(true);setError('');setStage('Preparing selected room');setFov(75)
    const requestId=crypto.randomUUID()
    const progress=setInterval(()=>{fetch(`/api/interior-preview/status/${requestId}`).then(r=>r.json()).then(data=>setStage(data.stage)).catch(()=>{})},1000)
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),610_000)
    try {
      const response=await fetch('/api/interior-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({design,config,quality:store.quality,requestId}),signal:controller.signal})
      const data=await response.json()
      if(!response.ok) throw new Error(data.error || 'Preview unavailable.')
      store.remember(savedKey,{url:data.url,initialYaw:data.initialYaw})
      setFresh(!data.cached)
    } catch(e) {setError(e instanceof Error?e.message:'Preview unavailable. Please retry.')}
    finally {clearTimeout(timer);clearInterval(progress);setBusy(false)}
  }
  return <section className="border border-line p-5 mt-6" aria-label="Fast 360 interior preview">
    <h2 className="font-display text-2xl">Fast 360° Interior Preview</h2>
    <p className="mt-2 text-sm text-ink-dim">The selected room from your validated plan, dressed in exactly what you chose on Finishes &amp; Cost. Drag the panorama to look around.</p>
    <div className="mt-5 grid gap-6 lg:grid-cols-[320px_1fr]">
      <div ref={panel} className="space-y-3">
        {select('Floor',String(room?.floor??0),[...new Set(rooms.map(r=>r.floor))].map(f=>({id:String(f),label:rooms.find(r=>r.floor===f)!.floorName})),v=>{const r=rooms.find(r=>r.floor===Number(v))!;store.set({room:{floor:r.floor,roomId:r.id}})})}
        {select('Room',room?.id??'',rooms.filter(r=>r.floor===room?.floor).map(r=>({id:r.id,label:r.name})),v=>store.set({room:{floor:room!.floor,roomId:v}}))}
        {finishes && <div className="border border-line p-3" aria-label="Finishes in this room">
          <div className="flex items-baseline justify-between gap-2"><p className="label">From your Finishes &amp; Cost</p><Link to="/workspace/finishes?tab=specifications" className="text-xs underline">Change</Link></div>
          <ul className="mt-2 space-y-1.5">{finishes.summary.map(s=><li key={s.label} className="flex items-center gap-2 text-xs">
            {s.image?<img src={s.image} alt="" className="h-7 w-7 flex-none rounded border border-line bg-white object-contain"/>:<span className="h-7 w-7 flex-none rounded border border-line bg-bg-inset"/>}
            <span className="min-w-0"><span className="block text-ink-faint">{s.label}</span><span className="block truncate text-ink">{s.value}</span></span></li>)}</ul>
        </div>}
        {select('Interior style',config.style,INTERIOR_STYLES,v=>store.set({style:v}))}
        {select('Lighting',config.lighting,LIGHTINGS,v=>store.set({lighting:v}))}
        {select('Furniture density',config.furnitureDensity,DENSITIES,v=>store.set({furnitureDensity:v}))}
        {select('Quality',store.quality,[{id:'fast',label:'Fast · 2048 × 1024'},{id:'high',label:'High · 4096 × 2048'}],v=>store.set({quality:v as Quality}))}
        <button disabled={busy || !room} onClick={run} className="w-full bg-accent p-3 text-white disabled:opacity-50">{busy?'Rendering selected room…':saved?'Render again':'Generate Fast Preview'}</button>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      </div>
      <div className="min-w-0">
        <p className="mb-3 text-sm text-ink-dim">{room?.name} · {room?.w.toFixed(2)} × {room?.d.toFixed(2)} m</p>
        <div ref={viewer} className="bg-bg" style={{height:fullscreen?'100vh':520,position:fullscreen?'fixed':'relative',inset:fullscreen?0:undefined,zIndex:fullscreen?1000:undefined,touchAction:'none'}} aria-label="Interactive 360 panorama"
          onTouchStart={e=>{if(e.touches.length===2)pinch.current=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY)}}
          onTouchMove={e=>{if(e.touches.length===2 && pinch.current!==null){const distance=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);setFov(f=>Math.max(35,Math.min(100,f+(pinch.current!-distance)*0.15)));pinch.current=distance}}}
          onTouchEnd={()=>{pinch.current=null}}>
          {result&&!busy?<Suspense fallback={<p className="p-5">Loading panorama…</p>}><Canvas frameloop="demand" key={result.url} camera={{position:[-Math.sin(result.initialYaw*Math.PI/180)*0.01,0,Math.cos(result.initialYaw*Math.PI/180)*0.01],fov:75}}><Panorama url={result.url} fov={fov} /></Canvas></Suspense>:<p role="status" className="p-6 text-ink-dim">{busy?stage:'Generate the 360° view of this room in your chosen finishes.'}</p>}
          {result && !busy && <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-2 text-sm"><button className="bg-bg border border-line px-3 py-2" onClick={()=>setFov(f=>Math.max(35,f-10))} aria-label="Zoom in">+</button><button className="bg-bg border border-line px-3 py-2" onClick={()=>setFov(f=>Math.min(100,f+10))} aria-label="Zoom out">−</button><button className="bg-bg border border-line px-3 py-2" onClick={async()=>{if(fullscreen){if(document.fullscreenElement)await document.exitFullscreen();else setFullscreen(false)}else{setFullscreen(true);try{await viewer.current?.requestFullscreen()}catch{/* Embedded browsers use the full-window overlay. */}}}}>{fullscreen?'Exit full screen':'Full screen'}</button></div>}
        </div>
        {result && !busy && <p className="mt-3 text-sm">{fresh?'Preview ready and saved.':`Saved preview · ${new Date(saved!.savedAt).toLocaleString()}`} <a className="underline" href={result.url} download="interior-360.webp">Download panorama</a></p>}
        {result && !busy && <div className="mt-3 flex gap-3 text-sm"><button onClick={run} className="border border-line p-2">Render again</button><Link to="/workspace/finishes?tab=specifications" className="border border-line p-2">Change finishes</Link><span className="p-2 text-ink-dim">Drag to look around · scroll or pinch to zoom</span></div>}
      </div>
    </div>
  </section>
}
