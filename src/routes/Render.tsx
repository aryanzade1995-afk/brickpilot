import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Clock, Eye, RefreshCw, Sparkles } from 'lucide-react'
import { useStudio } from '@/state/studio.ts'
import { useRender, REF_KEYS, REF_LABEL, type RefKey } from '@/state/render.ts'
import { THEMES, VIEW_PROMPT } from '@/lib/model/themes.ts'
import { PALETTE_MATERIALS } from '@/lib/engine/designDna.ts'
import { FloorDrawing } from '@/lib/draw/FloorDrawing.tsx'
import { MassingViewport, MASSING_CANVAS, type CaptureView } from '@/lib/render/CaptureCanvas.tsx'
import { rasterizeSvg } from '@/lib/render/rasterizeSvg.ts'
import { InteriorStudio } from '@/components/InteriorStudio.tsx'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { VillaGenerationNotice } from '@/components/VillaGenerationNotice.tsx'
import { InvalidPlanNotice } from '@/components/InvalidPlanNotice.tsx'
import { BlenderVillaPanel } from '@/components/BlenderVillaPanel.tsx'
import { cx } from '@/lib/cx.ts'
import { prepareInspiration } from '@/lib/render/prepareInspiration.ts'
import { useBlender } from '@/state/blender.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'

type Mode = 'building' | 'interior'

const CONCEPT_LABEL: Record<RefKey, string> = {
  front: 'Street-level front elevation',
  collage: 'Three-quarter aerial',
  top: 'Roof + site view',
  interior: 'Furnished interior concept',
}

export function Render() {
  const result = useStudio((s) => s.result)
  const planId = useMemo(() => result ? createBuildingModel(result.design).planId : null, [result])
  const blenderResult = useBlender((s) => planId ? s.accepted[planId] : undefined)
  const run = useStudio((s) => s.run)
  useEffect(() => {
    if (!result) run()
  }, [result, run])

  const {
    phase,
    refs,
    stale,
    jobs,
    health,
    error,
    inspiration,
    interiorRoomKey,
    probeHealth,
    setInteriorRoom,
    setInspiration,
    beginCapture,
    setRef,
    captureFailed,
    runJobs,
    retry,
    reset,
  } = useRender()

  const svgRef = useRef<SVGSVGElement>(null)
  const capBusy = useRef(false)
  const [view, setView] = useState<CaptureView>('orbit')
  const [mode, setMode] = useState<Mode>('building')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const lastDesignId = useRef<string | null>(null)

  useEffect(() => {
    const id = result ? `${result.design.id}:${blenderResult?.seed ?? 'study'}` : null
    if (lastDesignId.current && id && lastDesignId.current !== id) reset()
    lastDesignId.current = id
  }, [result, blenderResult?.seed, reset])

  useEffect(() => {
    probeHealth()
  }, [probeHealth])

  const rooms = useMemo(
    () =>
      result
        ? result.design.floors.flatMap((f) =>
            f.rooms
              .filter((r) => !r.outdoor)
              .map((r) => ({ key: `${f.level}:${r.id}`, label: `${r.name} · ${f.name}` })),
          )
        : [],
    [result],
  )

  useEffect(() => {
    if (result && !interiorRoomKey && rooms.length) {
      const social = result.design.floors[0].rooms.find((r) => r.zone === 'social' && !r.outdoor)
      setInteriorRoom(social ? `0:${social.id}` : rooms[0].key)
    }
  }, [result, interiorRoomKey, rooms, setInteriorRoom])

  // when capture starts: drive the viewport through 3 locked poses, read the
  // canvas after each, then rasterize the marked interior plan.
  useEffect(() => {
    if (phase !== 'capturing' || capBusy.current || !result?.report.hardChecksPass || (!result.shapeFingerprint && !blenderResult)) return
    capBusy.current = true
    let alive = true
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const canvas = () => document.querySelector<HTMLCanvasElement>(MASSING_CANVAS)

    ;(async () => {
      try {
        if (blenderResult) {
          for (const [key, file] of [['front', 'front'], ['collage', 'hero'], ['top', 'aerial']] as const) {
            const response = await fetch(blenderResult.files[file])
            if (!response.ok) throw new Error('Could not load the accepted Blender reference')
            const blob = await response.blob()
            const data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob)
            })
            if (!alive) return
            setRef(key, data)
          }
          if (alive && svgRef.current) setRef('interior', await rasterizeSvg(svgRef.current))
          return
        }
        // the 3D canvas may still be initialising when capture is requested
        for (let i = 0; i < 40 && alive && !(canvas()?.width ?? 0); i++) await wait(150)
        for (const key of ['front', 'collage', 'top'] as const) {
          if (!alive) return
          setView(key)
          await wait(950) // re-render → ViewRig effect → camera move → paint
          const el = canvas()
          if (!el) throw new Error('massing canvas unavailable')
          setRef(key, el.toDataURL('image/png'))
        }
        setView('orbit')
        if (alive && svgRef.current) setRef('interior', await rasterizeSvg(svgRef.current))
      } catch (e) {
        if (alive) captureFailed(String((e as Error).message))
      } finally {
        setView('orbit')
        capBusy.current = false
      }
    })()
    return () => {
      alive = false
    }
  }, [phase, setRef, captureFailed, result, blenderResult])

  if (!result) {
    return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">Preparing model…</div>
  }
  if (!result.report.hardChecksPass) return <InvalidPlanNotice report={result.report} />

  const { design, model } = result
  const character = model.brief.style.character
  const [lvlStr, roomId] = (interiorRoomKey ?? '0:').split(':')
  const interiorFloor = design.floors[Number(lvlStr)] ?? design.floors[0]
  const promptFor = (k: RefKey) => [
    blenderResult && k === 'top' ? 'Photorealistic aerial architectural photograph from the exact reference camera.' : VIEW_PROMPT[k],
    `Source-plan facts: ${design.floors.length} occupied storeys, ${design.openingCounts.windows} windows, ${design.openingCounts.doors} doors. Preserve the occupied footprint shown in the reference.`,
    blenderResult ? `Accepted architectural design: seed ${blenderResult.seed}, ${blenderResult.family} exterior composition, ${blenderResult.hero} hero and ${blenderResult.roofline} roofline. The source occupied rooms and floors are fixed.` :
      `Design identity: ${design.dna.styleFamily} style, ${design.dna.facadeComposition} composition, ${design.dna.entranceDesign} entry, ${design.dna.featureElement} feature, ${design.dna.balconyDesign} balcony treatment, ${design.dna.roofDesign} roof treatment, ${design.dna.materialPalette} palette.`,
    blenderResult && k !== 'interior'
      ? 'Preserve the accepted reference palette, material placement and primary/secondary/accent proportions. Improve their physical texture and reflections.'
      : `Use this coordinated material palette on the existing surfaces: ${PALETTE_MATERIALS[design.dna.materialPalette]}.`,
    `Landscape atmosphere: ${design.dna.landscapeMood.replaceAll('-', ' ')}. Apply this only to planting and site styling outside the building.`,
    k === 'interior' ? 'The first image is the existing room plan. Preserve the room boundary, door/window positions and circulation.' :
      'The first image is the accepted building geometry. Preserve its footprint, storey count, proportions, roof form, all door and window positions, balcony position, facade frames, pergola, canopies and major architectural volumes exactly. Do not invent or remove any opening, column, balcony, floor, frame or roof element.',
    k !== 'interior' && inspiration
      ? 'A second image follows the verified geometry image. Use the SECOND image for color, material mood, landscaping and lighting inspiration only. The FIRST image is the sole source for geometry, roof, floor count, openings, balconies and camera angle. Do not copy the second image building.'
      : '',
    'Improve only surface texture, material realism, glass reflections, landscaping, sky, lighting and photographic quality. Preserve the reference camera view.',
  ].filter(Boolean).join(' ')

  const hasRefs = REF_KEYS.every((k) => refs[k])
  const needsCapture = !hasRefs || stale
  const configuredNote =
    health && !health.reachable
      ? 'Render proxy offline — run `npm run dev` (or `npm run dev:proxy`).'
      : health && !health.configured && !health.mock
        ? 'No image-model key configured — add GEMINI_API_KEY to server/.env. Concepts will echo the reference until then.'
        : null

  const primary = () => {
    if (needsCapture) return beginCapture()
    if (phase === 'ready') return runJobs(promptFor)
    if (phase === 'gallery') return runJobs(promptFor)
  }
  const primaryLabel =
    phase === 'capturing'
      ? 'Capturing references…'
      : phase === 'rendering'
        ? 'Grounding concepts…'
        : needsCapture
          ? hasRefs
            ? 'Refresh reference set'
            : 'Prepare reference set'
          : phase === 'gallery'
            ? 'Regenerate concepts'
            : 'Generate grounded concepts'

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
      <WorkspaceTabs />
      {mode === 'building' && result?.report.hardChecksPass && <BlenderVillaPanel plan={result.design} />}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">{model.brief.project.name}</h1>
        <div className="flex items-center gap-3">
          <div className="flex border border-line-strong">
            {(['building', 'interior'] as Mode[]).map((mkey) => (
              <button
                key={mkey}
                type="button"
                onClick={() => setMode(mkey)}
                className={cx(
                  'px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] transition-colors',
                  mkey === 'interior' && 'border-l border-line-strong',
                  mode === mkey ? 'bg-accent text-white' : 'text-ink-dim hover:text-ink',
                )}
              >
                {mkey === 'building' ? 'Building concepts' : 'AI Interior'}
              </button>
            ))}
          </div>
          <div className="label text-accent">Step 4 · Render</div>
        </div>
      </div>

      {mode === 'interior' && <InteriorStudio design={design} character={character} />}

      {mode === 'building' && !result.shapeFingerprint && !blenderResult && <VillaGenerationNotice blocked />}

      {mode === 'building' && (result.shapeFingerprint || blenderResult) && (
        <>
          {configuredNote && (
            <p className="mt-4 border-l-2 border-warn/60 bg-warn/5 px-4 py-2.5 text-sm text-ink-dim">
              {configuredNote}
            </p>
          )}
          {error && (
            <p className="mt-4 border-l-2 border-bad/60 bg-bad/5 px-4 py-2.5 text-sm text-ink-dim">{error}</p>
          )}
          {uploadError && <p className="mt-4 text-sm text-bad">{uploadError}</p>}

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
            {/* live massing — the reference source */}
        <div>
          {blenderResult ? <img src={blenderResult.files.hero} alt="Accepted architectural design used for image references" className="w-full border border-line" /> : <MassingViewport design={design} character={character} view={view} />}
          <div className="mt-3 grid grid-cols-4 gap-3">
            {REF_KEYS.map((k) => (
              <figure key={k} className="space-y-1.5">
                <div className="relative flex aspect-[3/2] items-center justify-center overflow-hidden border border-line-strong bg-bg-inset">
                  {refs[k] ? (
                    <img src={refs[k]} alt={REF_LABEL[k]} className="h-full w-full object-cover" />
                  ) : (
                    <Camera size={13} className="text-ink-faint" />
                  )}
                </div>
                <figcaption className="label text-center">{REF_LABEL[k]}</figcaption>
              </figure>
            ))}
          </div>
        </div>

        {/* controls */}
        <div className="space-y-4">
          <div className="border border-line">
            <div className="label flex items-center justify-between border-b border-line px-4 py-2.5">
              Reference set
              <span className="text-ink-faint">Local only</span>
            </div>
            <div className="space-y-3 p-4">
              <label className="block">
                <span className="label">Interior source</span>
                <select
                  value={interiorRoomKey ?? ''}
                  onChange={(e) => setInteriorRoom(e.target.value)}
                  className="mt-2 w-full border border-line-strong bg-bg-inset px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
                >
                  {rooms.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[0.8rem] leading-relaxed text-ink-faint">
                The marked interior plan and three fixed 3:2 camera sources ground four separate
                image-edit jobs. References remain in this browser until confirmation.
              </p>
            </div>
          </div>

          <div className="border border-line p-4">
            <div className="label mb-2">Character</div>
            <div className="font-display text-lg">{THEMES[character].label}</div>
            <p className="mt-1 text-xs text-ink-dim">{THEMES[character].blurb}</p>
          </div>
          <div className="border border-line p-4">
            <div className="label mb-2">Reference image inspiration</div>
            <p className="mb-3 text-xs leading-relaxed text-ink-dim">Add an image for materials, color and atmosphere. Your generated model remains the geometry source.</p>
            <input type="file" accept="image/png,image/jpeg,image/webp" className="block w-full text-xs text-ink-dim"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                try { setInspiration(await prepareInspiration(file)); setUploadError(null) }
                catch (e) { setUploadError((e as Error).message) }
              }} />
            {inspiration && <div className="mt-3 flex items-center gap-3">
              <img src={inspiration} alt="Inspiration" className="h-16 w-20 object-cover" />
              <button type="button" className="text-xs text-ink-dim underline" onClick={() => setInspiration(null)}>Remove image</button>
            </div>}
          </div>
          <div className="border border-line p-4 text-xs text-ink-dim">
            <div className="label mb-2">Grounded to</div>
            <ul className="space-y-1">
              <li>— {design.floors.length} storeys · {design.builtAreaSqm.toFixed(0)} m²</li>
              <li>— {design.openingCounts.windows} windows · {design.openingCounts.doors} doors</li>
              <li>— footprint and massing are fixed; only material, light and context change</li>
            </ul>
          </div>
        </div>
      </div>

      {/* action bar */}
      <div className="mt-4 flex flex-col gap-3 border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Camera size={16} className="mt-0.5 text-accent" />
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.12em] text-ink">
              Front + Collage + Top + Interior
            </div>
            <div className="mt-1 flex items-center gap-1.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
              <Clock size={11} /> Four camera-locked async edits
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={primary}
          disabled={phase === 'capturing' || phase === 'rendering'}
          className={cx(
            'flex flex-none items-center justify-center gap-2 px-5 py-3 font-mono text-xs uppercase tracking-[0.12em] transition-colors',
            phase === 'capturing' || phase === 'rendering'
              ? 'border border-line text-ink-faint'
              : needsCapture
                ? 'border border-line-strong text-ink hover:border-ink-dim hover:bg-bg-raised'
                : 'bg-accent text-white hover:bg-accent-hot',
          )}
        >
          {needsCapture && hasRefs ? <RefreshCw size={13} /> : <Sparkles size={13} />}
          {primaryLabel}
        </button>
      </div>

      {/* gallery */}
      {(phase === 'rendering' || phase === 'gallery') && (
        <section className="mt-10 border-t border-line pt-8">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-2xl">
              {phase === 'gallery' ? 'Grounded concepts' : 'Grounding concepts…'}
            </h2>
            <span className="label">Generative — materials, light and furnishing are assumptions</span>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {REF_KEYS.map((k) => {
              const job = jobs[k]
              return (
                <figure key={k} className="border border-line">
                  <div className="relative flex aspect-[3/2] items-center justify-center overflow-hidden bg-bg-inset">
                    {job.status === 'done' && job.url ? (
                      <img src={job.url} alt={CONCEPT_LABEL[k]} className="h-full w-full object-cover" />
                    ) : job.status === 'error' ? (
                      <div className="px-4 text-center">
                        <p className="text-xs text-bad">{job.error}</p>
                        <button
                          type="button"
                          onClick={() => retry(k, promptFor)}
                          className="mt-2 border border-line-strong px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-dim hover:text-ink"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                        {job.status === 'running' ? 'Editing' : 'Queued'}
                      </div>
                    )}
                  </div>
                  <figcaption className="flex items-center justify-between border-t border-line px-3 py-2 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-ink-faint">
                    <span>{CONCEPT_LABEL[k]}</span>
                    {job.status === 'done' && <Eye size={11} className="text-ok" />}
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </section>
      )}

          {/* offscreen interior-plan source for the fourth reference */}
          <div aria-hidden style={{ position: 'fixed', left: -10000, top: 0, width: 1200, height: 800 }}>
            <FloorDrawing
              svgRef={svgRef}
              floor={interiorFloor}
              model={model}
              theme="dark"
              showLabels
              showDimensions={false}
              markRoomId={roomId || undefined}
            />
          </div>
        </>
      )}
    </div>
  )
}
