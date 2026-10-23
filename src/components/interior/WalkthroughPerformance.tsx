/* eslint-disable react/immutability -- Owned renderer resolution/light state is imperative R3F state. */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { PointLight } from 'three'
import type { WalkthroughAppearancePayload } from '@/lib/walkthrough/delivery.ts'
import { WALKTHROUGH_QUALITY, type WalkthroughQuality } from '@/lib/walkthrough/quality.ts'

export type WalkthroughMetrics = { fps: number; calls: number; triangles: number; dpr: number; renderer: string; pageVisible: boolean; focused: boolean; renderMs: number }

/** Measure real presented frames while walking; lower only pixel resolution
 * under load. Geometry, materials and collision accuracy never change. The
 * 40 FPS target is a budget, not a hardware guarantee. Orbit stays demand-only. */
export function WalkthroughPerformance({ active, revision, quality = 'adaptive', onMetrics }: { active: boolean; revision: number; quality?: WalkthroughQuality; onMetrics: (value: WalkthroughMetrics) => void }) {
  const { gl, setDpr, invalidate } = useThree()
  const budget = WALKTHROUGH_QUALITY[quality]
  const sample = useRef({ elapsed: 0, frames: 0, warm: 0, good: 0, ratio: 1.25 })
  const renderer = useRef('Unavailable')
  const renderMs = useRef(0)
  useEffect(() => {
    const render=gl.render
    gl.render=(...args) => {const start=performance.now();try {render.apply(gl,args)} finally {renderMs.current=performance.now()-start}}
    return () => {gl.render=render}
  },[gl])
  useEffect(() => { const context = gl.getContext(), extension = context.getExtension('WEBGL_debug_renderer_info'); if (extension) renderer.current = String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL)) }, [gl])
  useEffect(() => { gl.shadowMap.needsUpdate = true; invalidate(); sample.current.warm = 0 }, [revision, gl, invalidate])
  useEffect(() => { sample.current = { elapsed: 0, frames: 0, warm: 0, good: 0, ratio: budget.start }; setDpr(budget.start); invalidate() }, [active, budget, setDpr, invalidate])
  useFrame((_, dt) => {
    if (!active || dt <= 0) return
    const s = sample.current; s.warm += dt
    if (document.hidden) { s.elapsed = s.frames = 0; s.warm = 0; return }
    if (s.warm < 1) return
    s.elapsed += dt; s.frames++
    if (s.elapsed < 1) return
    const fps = s.frames / s.elapsed, previous = s.ratio
    if (fps < 44) { s.ratio = Math.max(budget.min, s.ratio - .15); s.good = 0 }
    else if (fps > 57) { if (++s.good >= 4) { s.ratio = Math.min(budget.max, s.ratio + .1); s.good = 0 } }
    else s.good = 0
    if (s.ratio !== previous) setDpr(s.ratio)
    onMetrics({ fps: Math.round(fps), calls: gl.info.render.calls, triangles: gl.info.render.triangles, dpr: +s.ratio.toFixed(2), renderer: renderer.current, pageVisible: !document.hidden, focused: document.hasFocus(), renderMs: +renderMs.current.toFixed(2) })
    s.elapsed = s.frames = 0
  })
  return null
}

/** At most two unshadowed local lights from the selected actual fittings.
 * No light-per-bulb draw/shadow explosion across a multi-storey house. */
export function WalkthroughRoomLights({ appearance }: { appearance?: WalkthroughAppearancePayload }) {
  const lights = useRef<(PointLight | null)[]>([]), counter = useRef(0)
  const emitters = (appearance?.furniture ?? []).filter(p => p.sourceIds.includes('ceiling-light'))
  useFrame(({ camera }, dt) => {
    counter.current += dt
    if (counter.current < .15) return
    counter.current = 0
    const nearest = emitters.filter(p => p.position[1] > camera.position.y && p.position[1] - camera.position.y < 3)
      .map(p => ({ p, distance: Math.hypot(p.position[0] - camera.position.x, p.position[2] - camera.position.z) }))
      .filter(p => p.distance < 6).sort((a, b) => a.distance - b.distance).slice(0, 2)
    lights.current.forEach((light, i) => {
      if (!light) return
      const item = nearest[i]; light.visible = !!item
      if (item) { light.position.set(item.p.position[0], item.p.position[1] - .12, item.p.position[2]); light.color.set(appearance?.bindings[item.p.binding]?.emissive ?? '#fff2d6') }
    })
  })
  return <>{[0, 1].map(i => <pointLight key={i} ref={light => { lights.current[i] = light }} visible={false} intensity={14} distance={7} decay={2} />)}</>
}
