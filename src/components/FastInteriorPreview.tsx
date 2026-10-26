import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useTexture } from '@react-three/drei'
import { BackSide, SRGBColorSpace, PerspectiveCamera } from 'three'
import type { Design } from '@/lib/engine/types.ts'
import { previewRooms, defaultConfiguration, INTERIOR_STYLES, LIGHTINGS, DENSITIES, INTERIOR_PREVIEW_VERSION, type InteriorConfiguration, type Quality } from '@/lib/interior/preview.ts'
import { interiorFinishes } from '@/lib/interior/finishes.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'
import { useInterior360 } from '@/state/interior360.ts'
import { finishSignature } from '@/lib/cost/finishAssignments.ts'
import { RoomPlan2D } from '@/components/RoomPlan2D.tsx'
import { ExportDropdown } from '@/components/export/ExportDropdown.tsx'
import { captureCanvasPng, downloadPanoramaEquirectangular } from '@/lib/export/index.ts'

class PanoramaBoundary extends Component<{children:ReactNode; onError:()=>void}, {failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  componentDidCatch(){this.props.onError()}
  render(){return this.state.failed?<p className="p-5">{translateUi("Panorama unavailable. Generate it again.")}</p>:this.props.children}
}

function Panorama({ url, fov, onYawChange }: {url:string;fov:number;onYawChange?:(yaw:number)=>void}) {
  useLanguage(s => s.language);

  const texture=useTexture(url, texture=>{if('colorSpace' in texture)texture.colorSpace=SRGBColorSpace})
  const camera=useThree(s=>s.camera), invalidate=useThree(s=>s.invalidate)
  useEffect(()=>{if(camera instanceof PerspectiveCamera){camera.fov=fov;camera.updateProjectionMatrix();invalidate()}},[camera,fov,invalidate])
  return <><mesh scale={[-1,1,1]} rotation={[0,-Math.PI/2,0]}><sphereGeometry args={[10,64,32]} /><meshBasicMaterial map={texture} side={BackSide} /></mesh><OrbitControls enablePan={false} enableZoom={false} rotateSpeed={-0.4} target={[0,-0.002,0]} onChange={()=>{
    if (camera && onYawChange) {
      let deg = Math.atan2(-camera.position.x, camera.position.z) * 180 / Math.PI
      if (deg < 0) deg += 360
      onYawChange(deg)
    }
  }} /></>
}

/** Fast 360 preview of one room, dressed in exactly what was chosen on Finishes & Cost. */
export function FastInteriorPreview({design}: {design:Design}) {
  useLanguage(s => s.language);

  const rooms=useMemo(()=>previewRooms(design),[design])
  const store=useInterior360()
  const room=rooms.find(r=>r.id===store.room?.roomId && r.floor===store.room?.floor) ?? rooms[0]
  const config: InteriorConfiguration = useMemo(()=>({...defaultConfiguration(room?.id??'',room?.floor??0),
    style:store.style as InteriorConfiguration['style'], lighting:store.lighting as InteriorConfiguration['lighting'], furnitureDensity:store.furnitureDensity as InteriorConfiguration['furnitureDensity']}),
    [room?.id,room?.floor,store.style,store.lighting,store.furnitureDensity])
  const finishes=useMemo(()=>room?interiorFinishes(design,room.floor,room.id):null,[design,room?.id,room?.floor]) // eslint-disable-line react-hooks/exhaustive-deps
  const designId=useMemo(()=>createBuildingModel(design).planId,[design])
  // one saved preview per room, style, lighting, furniture, quality and finishes: change any finish and it is made again
  const signature=finishSignature(design.model.brief)
  const savedKey=useMemo(()=>JSON.stringify([INTERIOR_PREVIEW_VERSION,designId,config,store.quality,signature,finishes]),[designId,config,store.quality,signature,finishes])
  const saved=store.saved[savedKey]
  const [busy,setBusy]=useState(false), [error,setError]=useState('')
  const [stage,setStage]=useState('Preparing selected room'), [fov,setFov]=useState(75), [fullscreen,setFullscreen]=useState(false)
  const [showFullscreenMap, setShowFullscreenMap] = useState(true)
  const [liveYaw, setLiveYaw] = useState<number | undefined>(undefined)
  const rafId = useRef<number | null>(null)
  const handleYawChange = useCallback((yaw: number) => {
    if (rafId.current !== null) return
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null
      setLiveYaw(yaw)
    })
  }, [])
  useEffect(() => {
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current)
    }
  }, [])
  const currentRoomKey = `${room?.floor}:${room?.id}`
  const [prevRoomKey, setPrevRoomKey] = useState(currentRoomKey)
  if (prevRoomKey !== currentRoomKey) {
    setPrevRoomKey(currentRoomKey)
    setLiveYaw(undefined)
  }
  const viewer=useRef<HTMLDivElement>(null), panel=useRef<HTMLDivElement>(null), pinch=useRef<number|null>(null)
  const [fresh,setFresh]=useState(false)
  // a dropped graphics context (driver reset, GPU memory pressure) remounts the viewer instead of leaving it blank
  const [glLoss,setGlLoss]=useState(0)
  const [verifiedKey,setVerifiedKey]=useState(''), [checking,setChecking]=useState(false)
  const currentKey=useRef(savedKey);currentKey.current=savedKey
  const activeRequest=useRef<AbortController|null>(null)
  useEffect(()=>{const change=()=>setFullscreen(document.fullscreenElement===viewer.current);document.addEventListener('fullscreenchange',change);return()=>document.removeEventListener('fullscreenchange',change)},[])
  const result=saved && verifiedKey===savedKey?{url:saved.url,initialYaw:saved.initialYaw}:null
  useEffect(()=>{const element=viewer.current;if(!element || !result)return;const zoom=(e:WheelEvent)=>{e.preventDefault();setFov(f=>Math.max(35,Math.min(100,f+e.deltaY*0.04)))};element.addEventListener('wheel',zoom,{passive:false});return()=>element.removeEventListener('wheel',zoom)},[result])
  useEffect(()=>{
    // Browser persistence is a hint. The server checks current code, textures and
    // file integrity before a saved image can be displayed.
    activeRequest.current?.abort();setBusy(false);setError('');setFresh(false);setChecking(true)
    const controller=new AbortController()
    fetch('/api/interior-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({design,config,quality:store.quality,lookupOnly:true}),signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not check preview.');return data})
      .then(data=>{
        if(controller.signal.aborted || currentKey.current!==savedKey)return
        if(data.cached) {
          if(useInterior360.getState().saved[savedKey]?.url!==data.url)useInterior360.getState().remember(savedKey,{url:data.url,initialYaw:data.initialYaw})
        }else useInterior360.getState().forget(savedKey)
        setVerifiedKey(savedKey)
      }).catch(e=>{if(!controller.signal.aborted && currentKey.current===savedKey)setError(e instanceof Error?e.message:'Could not check saved preview.')})
      .finally(()=>{if(!controller.signal.aborted && currentKey.current===savedKey)setChecking(false)})
    return()=>{controller.abort();activeRequest.current?.abort()}
  },[savedKey,design,config,store.quality])
  const select=(label:string,value:string,list:readonly {id:string;label:string}[],change:(value:string)=>void)=><label className="block min-w-0 text-sm">{translateUi(label)}<select disabled={busy} className="mt-1 w-full min-w-0 max-w-full border border-line bg-bg p-2" value={value} onChange={e=>change(e.target.value)}>{list.map(o=><option key={o.id} value={o.id}>{translateUi(o.label)}</option>)}</select></label>
  const run=async()=> {
    if(!room || busy || checking)return
    setBusy(true);setError('');setStage('Preparing selected room');setFov(75)
    const requestId=crypto.randomUUID()
    const controller=new AbortController();activeRequest.current=controller
    const isCurrent=()=>!controller.signal.aborted && currentKey.current===savedKey && activeRequest.current===controller
    const progress=setInterval(()=>{fetch(`/api/interior-preview/status/${requestId}`,{signal:controller.signal}).then(r=>r.json()).then(data=>{if(isCurrent())setStage(data.stage)}).catch(()=>{})},1000)
    let timedOut=false
    const timer=setTimeout(()=>{timedOut=true;controller.abort()},610_000)
    try {
      const response=await fetch('/api/interior-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({design,config,quality:store.quality,requestId}),signal:controller.signal})
      const data=await response.json()
      if(!response.ok) throw new Error(data.error || 'Preview unavailable.')
      if(!isCurrent())return
      store.remember(savedKey,{url:data.url,initialYaw:data.initialYaw});setVerifiedKey(savedKey)
      setFresh(!data.cached)
    } catch(e) {if(currentKey.current===savedKey && activeRequest.current===controller && (!controller.signal.aborted || timedOut))setError(timedOut?'Rendering took too long. Please retry.':e instanceof Error?e.message:'Preview unavailable. Please retry.')}
    finally {clearTimeout(timer);clearInterval(progress);if(activeRequest.current===controller){activeRequest.current=null;setBusy(false)}}
  }
  return <section className="border border-line p-5 mt-6 relative" aria-label={translateUi("Fast 360 interior preview")}>
    <h2 className="font-display text-2xl">{translateUi("Fast 360° Interior Preview")}</h2>
    <p className="mt-2 text-sm text-ink-dim max-w-xl">{translateUi("The selected room from your validated plan, dressed in exactly what you chose on Finishes & Cost. Drag the panorama to look around.")}</p>
    
    {/* 2D Room Floor-Plan: placed in top-right on desktop, or stacked inline on smaller screens */}
    <div className="mt-4 lg:mt-0 lg:absolute lg:top-4 lg:right-5 w-full sm:w-[280px]">
      <RoomPlan2D
        design={design}
        roomId={room?.id}
        roomName={room?.name}
        floorLevel={room?.floor}
        density={store.furnitureDensity as InteriorConfiguration['furnitureDensity']}
        initialYaw={liveYaw ?? result?.initialYaw}
      />
    </div>

    <div className="mt-5 grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div ref={panel} className="min-w-0 space-y-3">
        {translateUi(select('Floor',String(room?.floor??0),[...new Set(rooms.map(r=>r.floor))].map(f=>({id:String(f),label:rooms.find(r=>r.floor===f)!.floorName})),v=>{const r=rooms.find(r=>r.floor===Number(v))!;store.set({room:{floor:r.floor,roomId:r.id}})}))}
        {translateUi(select('Room',room?.id??'',rooms.filter(r=>r.floor===room?.floor).map(r=>({id:r.id,label:r.name})),v=>store.set({room:{floor:room!.floor,roomId:v}})))}
        {finishes && <div className="border border-line p-3" aria-label={translateUi("Finishes in this room")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="label">{translateUi("From your Finishes & Cost")}</p><Link to="/workspace/finishes?tab=specifications" className="text-xs underline">{translateUi("Change")}</Link></div>
          <ul className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-1">{finishes.summary.map(s=><li key={s.label} className="flex items-center gap-2 text-xs">
            {s.image?<img src={s.image} alt={translateUi("")} className="h-7 w-7 flex-none rounded border border-line bg-white object-contain"/>:<span className="h-7 w-7 flex-none rounded border border-line bg-bg-inset"/>}
            <span className="min-w-0"><span className="block break-words text-ink-faint">{translateUi(s.label)}</span><span className="block truncate text-ink" title={translateUi(s.value)}>{translateUi(s.value)}</span></span></li>)}</ul>
        </div>}
        {translateUi(select('Interior style',config.style,INTERIOR_STYLES,v=>store.set({style:v})))}
        {translateUi(select('Lighting',config.lighting,LIGHTINGS,v=>store.set({lighting:v})))}
        {translateUi(select('Furniture density',config.furnitureDensity,DENSITIES,v=>store.set({furnitureDensity:v})))}
        {translateUi(select('Quality',store.quality,[{id:'fast',label:'Fast · 2048 × 1024'},{id:'high',label:'High · 4096 × 2048'}],v=>store.set({quality:v as Quality})))}
        <button disabled={busy || checking || !room} onClick={run} className="w-full bg-accent p-3 text-white disabled:opacity-50">{translateUi(busy?'Rendering selected room…':checking?'Checking current finishes…':result?'Render again':'Generate Fast Preview')}</button>
        {error && <p role="alert" className="text-sm text-red-500">{translateUi(error)}</p>}
      </div>
      <div className="min-w-0">
        <p className="mb-3 text-sm text-ink-dim">{translateUi(room?.name)} · {translateUi(room?.w.toFixed(2))} × {translateUi(room?.d.toFixed(2))} {translateUi(" m")}</p>
        <div
          ref={viewer}
          className="bg-bg border border-line"
          style={{height:fullscreen?'100vh':520,position:fullscreen?'fixed':'relative',inset:fullscreen?0:undefined,zIndex:fullscreen?1000:undefined,touchAction:'none'}}
          aria-label={translateUi("Interactive 360 panorama")}
          onTouchStart={e=>{if(e.touches.length===2)pinch.current=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY)}}
          onTouchMove={e=>{if(e.touches.length===2 && pinch.current!==null){const distance=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);setFov(f=>Math.max(35,Math.min(100,f+(pinch.current!-distance)*0.15)));pinch.current=distance}}}
          onTouchEnd={()=>{pinch.current=null}}
        >
          {/* Full-Screen Floating HUD Mini-Map: keeps 2D map visible when exploring in full-screen */}
          {fullscreen && showFullscreenMap && (
            <div className="absolute top-4 right-4 z-30 w-[240px] pointer-events-auto shadow-2xl bg-bg-raised/95 backdrop-blur-md rounded border border-line overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-2.5 py-1 text-[11px] font-mono text-ink-dim bg-bg-inset/40">
                <span className="flex items-center gap-1.5 font-medium text-ink text-[11px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {translateUi("Floor Plan HUD")}
                </span>
                <button
                  type="button"
                  onClick={() => setShowFullscreenMap(false)}
                  className="hover:text-ink text-ink-dim transition-colors px-1 text-xs"
                  title={translateUi("Minimize Map")}
                >
                  ✕
                </button>
              </div>
              <RoomPlan2D
                design={design}
                roomId={room?.id}
                roomName={room?.name}
                floorLevel={room?.floor}
                density={store.furnitureDensity as InteriorConfiguration['furnitureDensity']}
                initialYaw={liveYaw ?? result?.initialYaw}
              />
            </div>
          )}
          {fullscreen && !showFullscreenMap && (
            <button
              type="button"
              onClick={() => setShowFullscreenMap(true)}
              className="absolute top-4 right-4 z-30 pointer-events-auto rounded border border-line bg-bg-raised/95 backdrop-blur-md px-3 py-1.5 text-xs font-mono text-ink shadow-lg hover:border-accent transition-colors flex items-center gap-2"
            >
              <span className="h-2 w-2 rounded-full bg-accent" />
              {translateUi("Show 2D Map")}
            </button>
          )}
          {result&&!busy?<PanoramaBoundary key={result.url} onError={()=>{useTexture.clear(result.url);store.forget(savedKey);setError('The saved panorama could not be loaded. Generate it again.')}}><Canvas key={glLoss} frameloop="demand" gl={{ preserveDrawingBuffer: true }} onCreated={({gl})=>gl.domElement.addEventListener('webglcontextlost',()=>setTimeout(()=>setGlLoss(n=>n+1),300),{once:true})} camera={{position:[-Math.sin(result.initialYaw*Math.PI/180)*0.01,0,Math.cos(result.initialYaw*Math.PI/180)*0.01],fov:75}}><Suspense fallback={null}><Panorama url={result.url} fov={fov} onYawChange={handleYawChange} /></Suspense></Canvas></PanoramaBoundary>:<p role="status" className="p-6 text-ink-dim">{translateUi(busy?stage:checking?'Checking saved preview against your current finishes…':'Generate the 360° view of this room in your chosen finishes.')}</p>}
          {result && !busy && (
            <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 text-sm pointer-events-auto">
              <div className="flex flex-wrap gap-2">
                <button className="bg-bg border border-line px-3 py-2" onClick={()=>setFov(f=>Math.max(35,f-10))} aria-label={translateUi("Zoom in")}>+</button>
                <button className="bg-bg border border-line px-3 py-2" onClick={()=>setFov(f=>Math.min(100,f+10))} aria-label={translateUi("Zoom out")}>−</button>
                <button className="bg-bg border border-line px-3 py-2" onClick={async()=>{if(fullscreen){if(document.fullscreenElement)await document.exitFullscreen();else setFullscreen(false)}else{setFullscreen(true);try{await viewer.current?.requestFullscreen()}catch{/* Embedded browsers use the full-window overlay. */}}}}>{translateUi(fullscreen?'Exit full screen':'Full screen')}</button>
              </div>
              <ExportDropdown
                label="Download 360"
                title="Download 360 View"
                items={[
                  {
                    id: 'pano-viewport-png',
                    label: 'Current Viewport',
                    ext: '.png',
                    onExport: async () => {
                      const canvas = viewer.current?.querySelector('canvas')
                      if (canvas) {
                        await captureCanvasPng(canvas, `${room?.name ? room.name.toLowerCase().replace(/\s+/g, '-') : 'room'}-view.png`)
                      }
                    },
                  },
                  {
                    id: 'pano-equirect-webp',
                    label: '360° Panorama',
                    ext: '.webp',
                    onExport: async () => {
                      if (result?.url) {
                        await downloadPanoramaEquirectangular(result.url, `${room?.name ? room.name.toLowerCase().replace(/\s+/g, '-') : 'room'}-360-equirectangular.webp`)
                      }
                    },
                  },
                ]}
              />
            </div>
          )}
        </div>
        {result && !busy && <p className="mt-3 text-sm">{translateUi(fresh?'Preview ready and saved.':`Saved preview · ${new Date(saved!.savedAt).toLocaleString()}`)} <a className="underline" href={result.url} download="interior-360.webp">{translateUi("Download panorama")}</a></p>}
        {result && !busy && <div className="mt-3 flex flex-wrap gap-3 text-sm"><button onClick={run} className="border border-line p-2">{translateUi("Render again")}</button><Link to="/workspace/finishes?tab=specifications" className="border border-line p-2">{translateUi("Change finishes")}</Link><span className="p-2 text-ink-dim">{translateUi("Drag to look around · scroll or pinch to zoom")}</span></div>}
      </div>
    </div>
  </section>
}
