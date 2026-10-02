import { newDesignSeed } from '@/lib/newDesignSeed.ts'
import { Component, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bounds, OrbitControls, useGLTF } from '@react-three/drei'
import type { Design } from '@/lib/engine/types.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'
import { useBlender } from '@/state/blender.ts'

function Villa({ url }: { url: string }) {
  const gltf = useGLTF(url)
  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true)
    const remove: typeof clone.children = []
    clone.traverse((object) => { if (object.userData.presentation_only || object.name.startsWith('Ground_Context') ||
      'isLight' in object || 'isCamera' in object) remove.push(object) })
    remove.forEach((object) => object.removeFromParent())
    return clone
  }, [gltf.scene])
  return <Bounds fit clip observe margin={1.2}><primitive object={scene} /></Bounds>
}
class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p className="p-6 text-sm text-ink-dim">The interactive model could not load. The images and downloads below are still available.</p> : this.props.children }
}

export function BlenderVillaPanel({ plan, autoGenerate = false }: { plan: Design; autoGenerate?: boolean }) {
  const id = useMemo(() => createBuildingModel(plan).planId, [plan])
  const result = useBlender((s) => s.accepted[id])
  const job = useBlender((s) => s.job)
  const sourcePlanId = useBlender((s) => s.sourcePlanId)
  const error = useBlender((s) => s.error)
  const generate = useBlender((s) => s.generate)
  const resume = useBlender((s) => s.resume)
  const ensureForPlan = useBlender((s) => s.ensureForPlan)
  const [quality, setQuality] = useState<'preview' | 'final'>('preview')
  const [view, setView] = useState<'hero' | 'front' | 'aerial'>('hero')
  const busy = Boolean(job && !['complete', 'failed'].includes(job.status))
  const currentJob = sourcePlanId === id ? job : null
  useEffect(() => { void resume() }, [resume])
  useEffect(() => { if (autoGenerate) void ensureForPlan(plan) }, [autoGenerate, plan, ensureForPlan, busy])
  return <section className="mt-5 border border-line p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="font-display text-xl">Blender architectural design</h2>
        <p className="mt-1 text-sm text-ink-dim">Your current rooms, footprint and planned outdoor spaces become one editable 3D villa.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Render quality" className="border border-line bg-bg px-3 py-2 text-sm" value={quality}
          disabled={busy} onChange={(e) => setQuality(e.target.value as 'preview' | 'final')}>
          <option value="preview">Fast preview</option><option value="final">High quality</option>
        </select>
        <button type="button" disabled={busy} onClick={() => void generate(plan, newDesignSeed(result?.seed ?? plan.dna.seed), quality)}
          className="border border-line-strong px-4 py-2 text-sm uppercase tracking-wide disabled:opacity-50">
          {busy ? 'Generating…' : result ? 'Generate another design' : 'Generate architectural design'}
        </button>
      </div>
    </div>
    {currentJob && busy && <p role="status" className="mt-4 text-sm text-ink-dim">{currentJob.phase}{currentJob.attempt ? ` · candidate ${currentJob.attempt}` : ''}. Rendering can take a few minutes.</p>}
    {busy && !currentJob && <p role="status" className="mt-4 text-sm text-ink-dim">Another plan is being generated. This plan will start when it finishes.</p>}
    {!result && <div className="mt-4 flex aspect-[4/3] items-center justify-center border border-line bg-bg-inset p-8 text-center text-sm text-ink-dim">
      {busy ? 'Building and rendering your villa…' : 'The interactive Blender model and three rendered views will appear here.'}
    </div>}
    {sourcePlanId === id && error && <p role="alert" className="mt-4 text-sm text-bad">{error}</p>}
    {result && <>
      <p className="mt-4 font-mono text-xs text-ink-dim">Seed {result.seed} · {result.family.replaceAll('_', ' ')} · {result.quality === 'final' ? 'Final render' : 'Preview'}</p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="aspect-[4/3] overflow-hidden border border-line">
          <ModelBoundary key={result.files.glb}><Canvas shadows camera={{ position: [20, 14, -25], fov: 40 }}>
            <color attach="background" args={['#e5e5e5']} /><ambientLight intensity={.6} />
            <directionalLight position={[20, 30, -10]} intensity={2} />
            <Suspense fallback={null}><Villa url={result.files.glb} /></Suspense>
            <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2} />
          </Canvas></ModelBoundary>
        </div>
        <div><img src={result.files[view]} alt={`${view} view of architectural design ${result.seed}`} className="aspect-[4/3] w-full object-contain" />
          <div className="mt-2 flex gap-2">{(['hero', 'front', 'aerial'] as const).map((key) =>
            <button type="button" key={key} onClick={() => setView(key)} className="border border-line px-3 py-1 text-xs uppercase">{key}</button>)}</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-sm">{(['blend', 'glb', 'hero', 'front', 'aerial'] as const).map((key) =>
        <a key={key} href={result.files[key]} download className="underline underline-offset-4">{key === 'blend' ? 'Editable Blender scene' : key === 'glb' ? 'Interactive 3D model' : `${key} image`}</a>)}</div>
    </>}
    {currentJob?.debug?.length ? <details className="mt-4 text-xs text-ink-dim"><summary>Design variation checks</summary>
      <ul className="mt-2 space-y-1">{currentJob.debug.map((entry, index) => <li key={index}>Seed {entry.seed} · {entry.family} · nearest seed {entry.nearestPreviousSeed ?? 'none'} · {entry.similarityPercent ?? 0}% similar · {entry.accepted ? 'Accepted' : 'Retried'}: {entry.reason}</li>)}</ul>
    </details> : null}
    <p className="mt-3 text-xs text-ink-faint">Geometry and architectural consistency checks; structural engineering review is still required.</p>
    <div className="mt-3 flex flex-wrap gap-4 text-xs">
      <a href="/output/wing-review/index.html" target="_blank" rel="noreferrer" className="underline underline-offset-4">View 100 designs per wing</a>
      <a href="/api/villas/gallery/" target="_blank" rel="noreferrer" className="underline underline-offset-4">Clay render gallery</a>
    </div>
  </section>
}
