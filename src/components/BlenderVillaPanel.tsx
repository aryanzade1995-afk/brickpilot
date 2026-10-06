import { useStudio } from '@/state/studio.ts'
import { finishSignature } from '@/lib/cost/finishAssignments.ts'
import { newDesignSeed } from '@/lib/newDesignSeed.ts'
import { Component, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Bounds, OrbitControls, useGLTF } from '@react-three/drei'
import type { Design } from '@/lib/engine/types.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'
import { useBlender, directionRenderKey } from '@/state/blender.ts'
import { RenderProgress } from './RenderProgress.tsx'
import { StudioReflections } from './StudioReflections.tsx'
import { separateCoplanar } from '@/lib/three/separateCoplanar.ts'

function Villa({ url }: { url: string }) {
  const gltf = useGLTF(url)
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy())
  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true)
    const remove: typeof clone.children = []
    clone.traverse((object) => { object.castShadow = true; object.receiveShadow = true
      if (object.userData.presentation_only || object.name.startsWith('Ground_Context') ||
      'isLight' in object || 'isCamera' in object) remove.push(object) })
    remove.forEach((object) => object.removeFromParent())
    // Thin layers laid on a wall or slab (cladding, tiles, glass, frames, sills) cast no shadow onto the face they sit on.
    clone.updateMatrixWorld(true)
    const size = new THREE.Vector3()
    clone.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      // fine cladding and tile textures seen at an angle: full anisotropic filtering and mipmaps, or their lines
      // shimmer into moire as the view turns
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) {
          value.anisotropy = maxAnisotropy; value.generateMipmaps = true; value.minFilter = THREE.LinearMipmapLinearFilter; value.needsUpdate = true
        }
      // Fluted stone is hundreds of centimetre-scale ribs: finer than a pixel here, they alias into lines that crawl
      // as the view turns. The live viewer shows each fluted panel as one smooth slab of the same stone; the Blender
      // renders and the downloadable scene keep every rib.
      if (/_Flutes(\.\d+)?$/.test(mesh.name)) {
        mesh.geometry.computeBoundingBox()
        const box = mesh.geometry.boundingBox!, slab = new THREE.BoxGeometry(...box.getSize(new THREE.Vector3()).toArray())
        slab.translate(...box.getCenter(new THREE.Vector3()).toArray())
        mesh.geometry = slab
        mesh.castShadow = false
        return
      }
      new THREE.Box3().setFromObject(mesh).getSize(size)
      if (Math.min(size.x, size.y, size.z) > 0.06) return
      mesh.castShadow = false
    })
    // faces of different parts in one plane (a beam flush with its wall, a slab edge on the facade) fight for the
    // same depth and flicker as the view turns: the lesser part's face steps back 1.5 mm
    separateCoplanar(clone)
    return clone
  }, [gltf.scene, maxAnisotropy])
  return <Bounds fit clip observe margin={1.2}><primitive object={scene} /></Bounds>
}
class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p className="p-6 text-sm text-ink-dim">The interactive model could not load. The images and downloads below are still available.</p> : this.props.children }
}

export function BlenderVillaPanel({ plan, autoGenerate = false, selectedSeed }: { plan: Design; autoGenerate?: boolean; selectedSeed?: number }) {
  const brief = useStudio(s => s.result?.design === plan ? s.brief : plan.model.brief)
  const finishedPlan = useMemo(() => ({ ...plan, model: { ...plan.model, brief } }), [plan, brief])
  const signature = finishSignature(brief)
  const id = useMemo(() => createBuildingModel(finishedPlan).planId, [finishedPlan])
  const accepted = useBlender((s) => s.accepted[id])
  const selectionKey = useBlender((s) => s.selectionKey)
  const job = useBlender((s) => s.job)
  const sourcePlanId = useBlender((s) => s.sourcePlanId)
  const previewKey = selectedSeed === undefined ? '' : directionRenderKey(id, selectedSeed)
  const result = selectedSeed === undefined || selectionKey === `${previewKey}:${signature}` || accepted?.seed === selectedSeed ? accepted : undefined
  const preview = useBlender((s) => s.previews[previewKey])
  const error = useBlender((s) => s.error)
  const generate = useBlender((s) => s.generate)
  const resume = useBlender((s) => s.resume)
  const ensureForPlan = useBlender((s) => s.ensureForPlan)
  const [quality, setQuality] = useState<'preview' | 'final'>('preview')
  const [view, setView] = useState<'hero' | 'front' | 'aerial'>('hero')
  const jobBusy = Boolean(job && !['complete', 'failed'].includes(job.status))
  const previewBusy = Boolean(preview && ['queued', 'generating', 'rendering'].includes(preview.status))
  const busy = jobBusy || previewBusy
  const currentJob = sourcePlanId === id ? job : null
  useEffect(() => { void resume() }, [resume])
  useEffect(() => { if (autoGenerate) void ensureForPlan(finishedPlan, selectedSeed) }, [autoGenerate, finishedPlan, selectedSeed, ensureForPlan, busy])
  return <section className="mt-5 border border-line p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="font-display text-xl">Blender architectural design</h2>
        <p className="mt-1 text-sm text-ink-dim">Your current rooms, footprint and planned outdoor spaces become one editable 3D villa.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Render quality" className="border border-line bg-bg px-3 py-2 text-sm" value={quality}
          disabled={busy} onChange={(e) => setQuality(e.target.value as 'preview' | 'final')}>
          <option value="preview">Fast preview</option><option value="final">High quality</option>
        </select>
        <button type="button" disabled={busy} onClick={() => void generate(finishedPlan, newDesignSeed(result?.seed ?? plan.dna.seed), quality)}
          className="border border-line-strong px-4 py-2 text-sm uppercase tracking-wide disabled:opacity-50">
          {busy ? 'Generating…' : result ? 'Generate another design' : 'Generate architectural design'}
        </button>
      </div>
    </div>
    {previewBusy && <RenderProgress progress={preview!.progress} label={preview!.phase} />}
    {previewBusy && <p role="status" className="mt-4 text-sm text-ink-dim">Preparing your selected direction: {preview!.phase}. The same villa will appear here when ready.</p>}
    {currentJob && jobBusy && !previewBusy && <RenderProgress progress={currentJob.progress} label={currentJob.phase} />}
    {currentJob && jobBusy && <p role="status" className="mt-4 text-sm text-ink-dim">{currentJob.phase}{currentJob.attempt ? ` · candidate ${currentJob.attempt}` : ''}. Rendering can take a few minutes.</p>}
    {jobBusy && !currentJob && !previewBusy && <p role="status" className="mt-4 text-sm text-ink-dim">Another plan is being generated. This plan will start when it finishes.</p>}
    {!result && <div className="mt-4 flex aspect-[4/3] items-center justify-center border border-line bg-bg-inset p-8 text-center text-sm text-ink-dim">
      {busy ? 'Building and rendering your villa…' : 'The interactive Blender model and three rendered views will appear here.'}
    </div>}
    {sourcePlanId === id && error && <p role="alert" className="mt-4 text-sm text-bad">{error}</p>}
    {result && <>
      {result.finishSignature !== signature && <p className="mt-3 text-sm text-ink-dim">Updating selected finishes on this same design…</p>}
      <p className="mt-4 font-mono text-xs text-ink-dim">Visualisation · Blender · Seed {result.seed} · {result.family.replaceAll('_', ' ')} · {result.quality === 'final' ? 'Final render' : 'Preview'}</p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="aspect-[4/3] overflow-hidden border border-line">
          <ModelBoundary key={result.files.glb}><Canvas frameloop="demand" shadows dpr={[1, 2]} gl={{ antialias: true, logarithmicDepthBuffer: true }} camera={{ position: [20, 14, -25], fov: 40 }}>
            <color attach="background" args={['#e5e5e5']} /><ambientLight intensity={.6} />
            <directionalLight position={[20, 30, -10]} intensity={2} castShadow shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-35} shadow-camera-right={35} shadow-camera-top={35} shadow-camera-bottom={-35} shadow-camera-far={100} shadow-bias={-0.0005} shadow-normalBias={.05} />
            <Suspense fallback={null}><StudioReflections /><Villa url={result.files.glb} /></Suspense>
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
      <p className="mt-3 text-xs text-ink-faint">Car: <a href="https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6" target="_blank" rel="noreferrer" className="underline">Ferrari 458 Italia by vicent091036</a>, adapted under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className="underline">CC BY 4.0</a>. Trees: <a href="https://polyhaven.com/a/island_tree_01" target="_blank" rel="noreferrer" className="underline">Poly Haven</a> (CC0).</p>
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
