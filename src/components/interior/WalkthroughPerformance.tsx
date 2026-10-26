/* eslint-disable react/immutability -- Owned renderer resolution/light state is imperative R3F state. */
import { useEffect, useRef,useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { PointLight } from 'three'
import type { WalkthroughAppearancePayload, WalkthroughGeometryPayload } from '@/lib/walkthrough/delivery.ts'
import { nearbyRoomEmitters } from '@/lib/walkthrough/roomLighting.ts'
import { WALKTHROUGH_QUALITY, adaptWalkthroughResolution, type WalkthroughQuality } from '@/lib/walkthrough/quality.ts'

export type WalkthroughMetrics = { fps: number; calls: number; triangles: number; dpr: number; renderer: string; pageVisible: boolean; focused: boolean; renderMs: number;
 averageFps:number;lowestWindowFps:number;p95Ms:number;p99Ms:number;gpuMs:number|null;width:number;height:number;displayWidth:number;displayHeight:number;textures:number;geometries:number;seconds:number;quality:WalkthroughQuality }

/** Measure real presented frames while walking; lower only pixel resolution
 * under load. Geometry, materials and collision accuracy never change. The
 * Selected 40/60 FPS targets are budgets, not hardware guarantees. Orbit stays demand-only. */
export function WalkthroughPerformance({ active, revision, quality = 'adaptive', onMetrics,nativeResolution=false }: { active: boolean; revision: number; quality?: WalkthroughQuality; onMetrics: (value: WalkthroughMetrics) => void;nativeResolution?:boolean }) {
  const { gl, setDpr, invalidate } = useThree()
  const budget = useMemo(()=>nativeResolution?{...WALKTHROUGH_QUALITY[quality],min:1,max:1,start:1}:WALKTHROUGH_QUALITY[quality],[quality,nativeResolution])
  const sample = useRef({ elapsed: 0, frames: 0, warm: 0, good: 0, ratio: 1.25 })
  const renderer = useRef('Unavailable')
  const renderMs = useRef(0)
  const gpuMs=useRef<number|null>(null),history=useRef<number[]>([]),windows=useRef<number[]>([])
  useEffect(() => {
    const render=gl.render,context=gl.getContext() as WebGL2RenderingContext,extension=context.getExtension('EXT_disjoint_timer_query_webgl2') as {TIME_ELAPSED_EXT:number;GPU_DISJOINT_EXT:number}|null,pending:WebGLQuery[]=[]
    gl.render=(...args) => {const start=performance.now();let query:WebGLQuery|null=null
      if(extension&&pending.length<3&&!context.isContextLost()){query=context.createQuery();if(query)context.beginQuery(extension.TIME_ELAPSED_EXT,query)}
      try {render.apply(gl,args)} finally {renderMs.current=performance.now()-start;if(query&&extension){context.endQuery(extension.TIME_ELAPSED_EXT);pending.push(query)}}
      if(extension&&pending.length&&context.getQueryParameter(pending[0],context.QUERY_RESULT_AVAILABLE)){
        const q=pending.shift()!;if(!context.getParameter(extension.GPU_DISJOINT_EXT))gpuMs.current=context.getQueryParameter(q,context.QUERY_RESULT)/1e6;context.deleteQuery(q)
      }
    }
    return () => {gl.render=render;pending.forEach(q=>context.deleteQuery(q))}
  },[gl])
  useEffect(() => { const context = gl.getContext(), extension = context.getExtension('WEBGL_debug_renderer_info'); if (extension) renderer.current = String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL)) }, [gl])
  useEffect(() => { gl.shadowMap.needsUpdate = true; invalidate(); sample.current.warm = 0 }, [revision, gl, invalidate])
  useEffect(() => { sample.current = { elapsed: 0, frames: 0, warm: 0, good: 0, ratio: budget.start };history.current=[];windows.current=[];setDpr(budget.start); invalidate() }, [active, budget, setDpr, invalidate])
  useFrame((_, dt) => {
    if (!active || dt <= 0) return
    const s = sample.current; s.warm += dt
    if (document.hidden) { s.elapsed = s.frames = 0; s.warm = 0; return }
    if (s.warm < 1) return
    history.current.push(dt);if(history.current.length>6000)history.current.shift()
    s.elapsed += dt; s.frames++
    if (s.elapsed < 1) return
    const fps = s.frames / s.elapsed, previous = s.ratio
    windows.current.push(fps);if(windows.current.length>120)windows.current.shift()
    if(!nativeResolution)Object.assign(s,adaptWalkthroughResolution(quality,fps,s.ratio,s.good))
    if (s.ratio !== previous) setDpr(s.ratio)
    const sorted=[...history.current].sort((a,b)=>a-b),seconds=history.current.reduce((a,b)=>a+b,0)
    onMetrics({ fps: Math.round(fps), calls: gl.info.render.calls, triangles: gl.info.render.triangles, dpr: +s.ratio.toFixed(2), renderer: renderer.current, pageVisible: !document.hidden, focused: document.hasFocus(), renderMs: +renderMs.current.toFixed(2),
      averageFps:Math.round(history.current.length/seconds),lowestWindowFps:Math.round(Math.min(...windows.current)),p95Ms:+(sorted[Math.floor(sorted.length*.95)]*1000).toFixed(2),p99Ms:+(sorted[Math.floor(sorted.length*.99)]*1000).toFixed(2),gpuMs:gpuMs.current===null?null:+gpuMs.current.toFixed(2),width:gl.domElement.width,height:gl.domElement.height,displayWidth:gl.domElement.clientWidth,displayHeight:gl.domElement.clientHeight,textures:gl.info.memory.textures,geometries:gl.info.memory.geometries,seconds:+seconds.toFixed(1),quality })
    s.elapsed = s.frames = 0
  })
  return null
}

/** At most two unshadowed local lights from the selected actual fittings.
 * No light-per-bulb draw/shadow explosion across a multi-storey house. */
export function WalkthroughRoomLights({ appearance, geometry }: { appearance?: WalkthroughAppearancePayload; geometry?:WalkthroughGeometryPayload|null }) {
  const lights = useRef<(PointLight | null)[]>([]), counter = useRef(0)
  const emitters = useMemo(()=>(appearance?.furniture ?? []).filter(p => p.sourceIds.includes('ceiling-light')),[appearance])
  useFrame(({ camera }, dt) => {
    counter.current += dt
    if (counter.current < .15) return
    counter.current = 0
    const nearest = nearbyRoomEmitters(emitters,camera.position.toArray(),geometry??undefined)
    lights.current.forEach((light, i) => {
      if (!light) return
      // Keep the shader light count stable across room boundaries. Toggling
      // visibility changes Three's program key and can compile while walking.
      const item = nearest[i]; light.intensity = item?.intensity ?? 0
      if (item) { light.position.set(item.p.position[0], item.p.position[1] - .12, item.p.position[2]); light.color.set(appearance?.bindings[item.p.binding]?.emissive ?? '#fff2d6') }
    })
  })
  return <>{[0, 1].map(i => <pointLight key={i} ref={light => { lights.current[i] = light }} intensity={0} distance={7} decay={2} />)}</>
}
