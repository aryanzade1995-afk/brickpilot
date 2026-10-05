import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Check, ImagePlus, Lock, MousePointer2, Plus, Sparkles, Trash2, Waypoints, Square } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { PhotoEditor } from '@/components/existing/PhotoEditor.tsx'
import { PlanLegend, PlanView } from '@/components/existing/PlanView.tsx'
import { useExisting, type Tool } from '@/state/existing.ts'
import { useStudio } from '@/state/studio.ts'
import { CONFIDENCE_FLOOR, type RoadSide } from '@/lib/existing/types.ts'
import { buildMapping } from '@/lib/existing/calibrate.ts'
import { compile } from '@/lib/model/canonical.ts'
import { briefFromAnswers } from '@/lib/existing/plan.ts'
import { cx } from '@/lib/cx.ts'

const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback)

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[0.72rem] leading-snug text-ink-faint">{hint}</p>}
    </label>
  )
}
const input = 'w-full border border-line-strong bg-bg-inset px-3 py-2 text-sm text-ink outline-none focus:border-accent'

/** the pipeline this mode runs, always visible so the user knows where they are */
function Pipeline({ step }: { step: number }) {
  const items = ['Site image', 'As-built model', 'Locked constraints', 'Valid 2D plan', 'BrickPilot 3D']
  const at = [0, 1, 3, 4, 5][Math.min(step, 4)] ?? 0
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 font-mono text-[0.68rem] uppercase tracking-[0.08em]">
      {items.map((t, i) => (
        <li key={t} className="flex items-center gap-2">
          <span className={cx('border px-2 py-1', i <= at ? 'border-accent text-accent' : 'border-line text-ink-faint')}>{t}</span>
          {i < items.length - 1 && <ArrowRight size={11} className="text-ink-faint" />}
        </li>
      ))}
    </ol>
  )
}

function Stepper() {
  const { step, setStep, imageUrl, plan } = useExisting()
  // three steps for the person; the review and map screens sit inside them
  const items: { at: number; label: string; on: boolean }[] = [
    { at: 0, label: 'Photo', on: step === 0 },
    { at: 2, label: 'Measurements', on: step === 1 || step === 2 || step === 3 },
    { at: 4, label: 'Plan', on: step === 4 },
  ]
  const reach = (at: number) => (at === 0 ? true : at === 2 ? !!imageUrl : !!plan)
  return (
    <div className="flex flex-wrap gap-1 border-b border-line pb-px">
      {items.map((it, i) => (
        <button key={it.label} type="button" disabled={!reach(it.at)} onClick={() => setStep(it.at)}
          className={cx('flex items-center gap-2 border-b-2 px-3 py-2.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] transition-colors disabled:opacity-40',
            it.on ? 'border-accent text-accent' : 'border-transparent text-ink-faint hover:text-ink-dim')}>
          <span>{String(i + 1).padStart(2, '0')}</span>{it.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------------------------- step 1: photo ---------------------------------- */
function PhotoStep() {
  const { loadFile, loadSample, busy, message, auto, sam } = useExisting()
  const picker = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
      <div>
        <div role="button" tabIndex={0} onClick={() => picker.current?.click()} onKeyDown={(e) => e.key === 'Enter' && picker.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void loadFile(f) }}
          className={cx('flex min-h-[18rem] cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed p-8 text-center transition-colors',
            over ? 'border-accent bg-accent/5' : 'border-line-strong bg-bg-inset hover:border-accent')}>
          <ImagePlus size={30} className="text-accent" />
          <p className="font-display text-xl">Drop a photo of your site here</p>
          <p className="max-w-sm text-sm text-ink-dim">or click to choose one. A JPG or PNG showing the columns, beams or foundation that are already built.</p>
          <input ref={picker} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f) }} />
        </div>
        {busy && (
          <div role="status" className="mt-4">
            <p className="text-sm text-ink-dim">{sam.state === 'loading' ? sam.label : (auto?.label ?? busy)}…</p>
            <div className="mt-2 h-1.5 w-full bg-line" role="progressbar" aria-valuenow={sam.state === 'loading' ? sam.pct : (auto?.pct ?? 0)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-accent transition-all" style={{ width: `${sam.state === 'loading' ? sam.pct : (auto?.pct ?? 0)}%` }} />
            </div>
            <p className="mt-1 text-xs text-ink-faint">Columns and beams are found automatically. Nothing to click.</p>
          </div>
        )}
        {message && !busy && <p role="status" className="mt-4 text-sm text-bad">{message}</p>}
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Button variant="ghost" onClick={loadSample}><Sparkles size={13} /> Try a demo site</Button>
          <span className="text-xs text-ink-faint">No photo handy? The demo is a 15 x 7.5 m column frame.</span>
        </div>
      </div>
      <div className="space-y-5">
        <div className="border border-line p-5">
          <p className="label">For the best result</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-dim">
            <li className="flex gap-2"><Check size={14} className="mt-0.5 flex-none text-ok" /> Stand back so every column base is in the picture.</li>
            <li className="flex gap-2"><Check size={14} className="mt-0.5 flex-none text-ok" /> A drone or roof-top shot from above is easiest to measure.</li>
            <li className="flex gap-2"><Check size={14} className="mt-0.5 flex-none text-ok" /> Know the real length and width of the built area.</li>
            <li className="flex gap-2"><Check size={14} className="mt-0.5 flex-none text-ok" /> Daylight, no heavy shadows across the columns.</li>
          </ul>
        </div>
        <div className="border border-line p-5">
          <p className="label">What happens next</p>
          <ol className="mt-3 space-y-2 text-sm text-ink-dim">
            <li><b className="text-ink">1.</b> We find the columns and beams in the photo for you.</li>
            <li><b className="text-ink">2.</b> You type the real length and width of what is built, and your plot size.</li>
            <li><b className="text-ink">3.</b> What is built becomes locked. We plan every room around it.</li>
            <li><b className="text-ink">4.</b> Rules check the plan. Then it goes into the normal 3D pipeline.</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------- step 2: detect ---------------------------------- */
const TOOLS: { id: Tool; label: string; icon: typeof Plus; hint: string }[] = [
  { id: 'move', label: 'Move', icon: MousePointer2, hint: 'Drag a marker onto the exact column base.' },
  { id: 'column', label: 'Add column', icon: Plus, hint: 'Click where a column meets the ground.' },
  { id: 'beam', label: 'Add beam', icon: Waypoints, hint: 'Click two columns to join them with a beam.' },
  { id: 'footing', label: 'Add footing', icon: Square, hint: 'Click a foundation pad that has no column yet.' },
  { id: 'remove', label: 'Remove', icon: Trash2, hint: 'Click a marker or beam to delete it.' },
]
const AI_TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'seg-column', label: 'AI: click a column', hint: 'Click the body of a column. The model outlines it and measures where it meets the ground.' },
  { id: 'seg-footing', label: 'AI: click a footing', hint: 'Click the middle of a foundation pad. The model outlines it and places the footing.' },
]

function DetectStep() {
  const s = useExisting()
  const { detections: d } = s
  const low = [...d.columns, ...d.beams, ...d.footings].filter((x) => !x.confirmed && x.confidence < CONFIDENCE_FLOOR)
  const tool = [...TOOLS, ...AI_TOOLS].find((t) => t.id === s.tool)!
  const anchors = d.columns.length + d.footings.length
  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div>
        <PhotoEditor imageUrl={s.imageUrl!} size={s.imageSize!} detections={d} mode="edit" tool={s.tool} beamFrom={s.beamFrom} corners={[]} calibration={s.calibration}
          highlight={low.map((x) => x.id)} onAddColumn={s.addColumn} onAddFooting={s.addFooting} onMove={s.moveColumn} onRemove={s.removeElement}
          onPickBeam={s.pickForBeam} onAddCorner={() => {}} onMoveCorner={() => {}} onSegment={s.segmentClick} mask={s.lastMask} />
        <p className="mt-2 text-xs text-ink-dim">{tool.hint}{s.tool === 'beam' && s.beamFrom ? ' Now click the second column.' : ''}</p>
        {s.message && <p role="status" className="mt-2 text-sm text-ink-dim">{s.message}</p>}
      </div>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" onClick={() => s.setTool(t.id)} aria-pressed={s.tool === t.id}
              className={cx('flex items-center gap-1.5 border px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.08em]', s.tool === t.id ? 'border-accent bg-accent/5 text-accent' : 'border-line text-ink-dim hover:text-ink')}>
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>
        <div className="border border-line p-4" aria-label="AI segmentation">
          <p className="label">Measure with AI</p>
          <p className="mt-1 text-xs text-ink-dim">Suggestions come from {s.engine === 'opencv' ? 'OpenCV line and shape analysis' : 'a basic edge scan'}, which is only a starting point on real photos. A small segmentation model, run in your browser, can measure any column or footing you click.</p>
          {s.sam.state === 'ready' ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {AI_TOOLS.map((t) => (
                  <button key={t.id} type="button" onClick={() => s.setTool(t.id)} aria-pressed={s.tool === t.id}
                    className={cx('border px-3 py-2 font-mono text-[0.68rem] uppercase tracking-[0.08em]', s.tool === t.id ? 'border-accent bg-accent/5 text-accent' : 'border-line text-ink-dim hover:text-ink')}>{t.label}</button>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={s.verifyWithSam} disabled={!!s.busy || !(d.columns.length + d.footings.length)}>Check every suggestion with the model</Button>
            </div>
          ) : (
            <div className="mt-3">
              <Button variant="ghost" size="sm" onClick={s.enableSam} disabled={s.sam.state === 'loading'}>{s.sam.state === 'loading' ? 'Starting…' : s.sam.state === 'error' ? 'Try again' : 'Turn on AI measuring (about 40 MB, once)'}</Button>
              {s.sam.state === 'loading' && (
                <div className="mt-2" role="progressbar" aria-valuenow={s.sam.pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-1.5 w-full bg-line"><div className="h-full bg-accent transition-all" style={{ width: `${s.sam.pct}%` }} /></div>
                  <p className="mt-1 text-xs text-ink-faint">{s.sam.label}</p>
                </div>
              )}
              {s.sam.state === 'error' && <p className="mt-2 text-xs text-bad">{s.sam.label}</p>}
            </div>
          )}
          {s.busy && <p className="mt-2 text-xs text-ink-faint">{s.busy}</p>}
        </div>
        <div className="grid grid-cols-3 gap-px border border-line bg-line text-center">
          {[['Columns', d.columns.length], ['Beams', d.beams.length], ['Footings', d.footings.length]].map(([l, n]) => (
            <div key={l as string} className="bg-bg px-3 py-3"><div className="font-display text-2xl">{n}</div><div className="label">{l}</div></div>
          ))}
        </div>
        <div className="border border-line p-4">
          <p className="label">Seen on site</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-sm">
            {(['foundation', 'columns', 'beams', 'slab', 'walls'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 capitalize">
                <input type="checkbox" className="accent-accent" checked={d.seen[k]} onChange={(e) => s.setSeen(k, e.target.checked)} /> {k}
              </label>
            ))}
          </div>
          <p className="mt-2 text-[0.72rem] text-ink-faint">Foundation only? Mark each footing and the columns will be proposed on them.</p>
        </div>
        {low.length > 0 ? (
          <div className="border-l-2 border-warn bg-warn/5 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-warn"><AlertTriangle size={14} /> {low.length} low-confidence detection{low.length > 1 ? 's' : ''} need your confirmation</p>
            <p className="mt-1 text-xs text-ink-dim">Check the dashed red markers on the photo, then confirm or delete each one.</p>
            <ul className="mt-2 space-y-1.5">
              {low.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{x.id} · {Math.round(x.confidence * 100)}%</span>
                  <span className="flex gap-1.5">
                    <button type="button" onClick={() => s.confirm(x.id)} className="border border-line-strong px-2 py-1 font-mono text-[0.62rem] uppercase hover:border-accent">Confirm</button>
                    <button type="button" onClick={() => s.removeElement(x.id)} className="border border-line px-2 py-1 font-mono text-[0.62rem] uppercase text-ink-dim hover:text-bad">Delete</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : anchors > 0 && (
          <p className="flex items-center gap-2 text-sm text-ok"><Check size={14} /> Every detection is confirmed.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={s.confirmAll} disabled={!anchors}>Confirm all</Button>
          <Button onClick={() => s.setStep(2)} disabled={anchors < 2 || low.length > 0}>Continue <ArrowRight size={13} /></Button>
        </div>
        {anchors < 2 && <p className="text-xs text-ink-faint">Mark at least two columns or footings to continue.</p>}
      </div>
    </div>
  )
}

/* ---------------------------------- step 2: measurements ---------------------------------- */
/** The only thing asked of the person: real measurements. The columns, beams and corners were found from the photo. */
function MeasureStep() {
  const s = useExisting()
  const { detections: d, answers: a, calibration: cal } = s
  const corners = cal.mode === 'corners' ? cal.pts : []
  const widthMm = cal.mode === 'corners' ? cal.widthMm : cal.mode === 'scale' ? cal.distanceMm : 0
  const depthMm = cal.mode === 'corners' ? cal.depthMm : 0
  const single = cal.mode === 'scale'
  const mapping = useMemo(() => buildMapping(cal, d.columns), [cal, d.columns])
  const ready = !!mapping.toPlan
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const road: RoadSide[] = ['N', 'E', 'S', 'W']
  const steppers: [string, keyof typeof a][] = [['Bedrooms with bath', 'bedroomsWithBath'], ['Bedrooms, shared bath', 'bedroomsNoBath'], ['Shared bathrooms', 'sharedBaths'], ['Studies', 'studies']]
  const setLength = (m: number) => s.setCalibration(cal.mode === 'corners' ? { ...cal, widthMm: Math.round(m * 1000) } : { ...cal, mode: 'scale', a: cal.mode === 'scale' ? cal.a : d.columns[0]?.id ?? '', b: cal.mode === 'scale' ? cal.b : d.columns.at(-1)?.id ?? '', distanceMm: Math.round(m * 1000) })
  const setWidth = (m: number) => { if (cal.mode === 'corners') s.setCalibration({ ...cal, depthMm: Math.round(m * 1000) }) }
  const build = () => {
    setError(null)
    const r = s.buildMap()
    if (!r.ok) { setError(r.error); return }
    s.generate(1)
    s.setStep(4)
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div>
        <PhotoEditor imageUrl={s.imageUrl!} size={s.imageSize!} detections={d} mode="edit" tool="move" beamFrom={null} corners={[]} calibration={cal}
          onAddColumn={() => {}} onAddFooting={() => {}} onMove={s.moveColumn} onRemove={() => {}} onPickBeam={() => {}} onAddCorner={() => {}} onMoveCorner={() => {}} />
        {corners.length === 4 && (
          <p className="mt-2 text-xs text-ink-faint">Measure between the numbered corners of the structure: 1 back-left, 2 back-right, 3 front-right.</p>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-x-3 text-sm text-ink-dim" role="status">
          <span className="flex items-center gap-1.5 text-ok"><Check size={14} /> Found {d.columns.length} column{d.columns.length === 1 ? '' : 's'}, {d.beams.length} beam{d.beams.length === 1 ? '' : 's'}{d.footings.length ? `, ${d.footings.length} footing${d.footings.length === 1 ? '' : 's'}` : ''} automatically.</span>
          <button type="button" className="underline" onClick={() => s.setStep(1)}>Review or fix what was found</button>
        </p>
        {single && <p className="mt-2 border-l-2 border-warn bg-warn/5 p-3 text-sm text-warn">Only one line of columns is visible, so the other side cannot be measured from this photo. A photo taken from a corner or from above shows both sides.</p>}
      </div>
      <div className="space-y-5">
        <div className="border border-line p-4">
          <p className="label">Measure the built structure</p>
          <p className="mt-1 text-xs text-ink-dim">{single ? 'Distance between the first and last column.' : 'Real distances between the corner columns of what is already built.'}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label={single ? 'Distance (m)' : 'Length, corner 1 to 2 (m)'}>
              <input className={input} type="number" min={1} step={0.1} value={widthMm ? widthMm / 1000 : ''} placeholder="e.g. 12" onChange={(e) => setLength(num(e.target.value, 0))} />
            </Field>
            {!single && (
              <Field label="Width, corner 2 to 3 (m)">
                <input className={input} type="number" min={1} step={0.1} value={depthMm ? depthMm / 1000 : ''} placeholder="e.g. 9" onChange={(e) => setWidth(num(e.target.value, 0))} />
              </Field>
            )}
          </div>
          {!ready && <p className="mt-2 text-xs text-ink-faint">{mapping.note}</p>}
        </div>

        <div className="border border-line p-4">
          <p className="label">Your plot</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Plot width (m)"><input className={input} type="number" min={6} step={0.5} value={a.plotWidthM} onChange={(e) => s.setAnswer('plotWidthM', num(e.target.value, a.plotWidthM))} /></Field>
            <Field label="Plot length (m)"><input className={input} type="number" min={6} step={0.5} value={a.plotDepthM} onChange={(e) => s.setAnswer('plotDepthM', num(e.target.value, a.plotDepthM))} /></Field>
          </div>
          <div className="mt-4">
            <span className="label">Road side (where is the entrance?)</span>
            <div className="mt-1.5 flex gap-1.5">
              {road.map((r) => (
                <button key={r} type="button" onClick={() => s.setAnswer('roadSide', r)} aria-pressed={a.roadSide === r}
                  className={cx('w-12 border py-2 font-mono text-xs', a.roadSide === r ? 'border-accent bg-accent/5 text-accent' : 'border-line text-ink-dim')}>{r}</button>
              ))}
              <span className="ml-2 self-center text-[0.72rem] text-ink-faint">Top of the photo is N.</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Floors already built"><select className={input} value={a.storeysBuilt} onChange={(e) => s.setAnswer('storeysBuilt', Number(e.target.value))}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n === 0 ? 'Foundation only' : `${n} floor${n > 1 ? 's' : ''} of columns`}</option>)}</select></Field>
            <Field label="Floors you want"><select className={input} value={a.storeysWanted} onChange={(e) => s.setAnswer('storeysWanted', Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          </div>
        </div>

        <div className="border border-line p-4">
          <button type="button" className="label flex w-full items-center justify-between" aria-expanded={more} onClick={() => setMore((v) => !v)}>
            <span>Rooms you need</span><span className="text-ink-faint">{more ? 'Hide' : `${a.bedroomsWithBath + a.bedroomsNoBath} bedrooms · change`}</span>
          </button>
          {more && (
            <div className="mt-3">
              <div className="grid grid-cols-2 gap-3">
                {steppers.map(([l, k]) => (
                  <Field key={k} label={l}><input className={input} type="number" min={0} max={8} value={a[k] as number} onChange={(e) => s.setAnswer(k, num(e.target.value, 0) as never)} /></Field>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {([['parking', 'Covered parking'], ['pooja', 'Pooja room'], ['utility', 'Utility room']] as const).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2"><input type="checkbox" className="accent-accent" checked={a[k]} onChange={(e) => s.setAnswer(k, e.target.checked)} /> {l}</label>
                ))}
              </div>
            </div>
          )}
        </div>
        {error && <p role="alert" className="border-l-2 border-bad bg-bad/5 p-3 text-sm text-bad">{error}</p>}
        <Button disabled={!ready} onClick={build}>Build my plan <ArrowRight size={13} /></Button>
        {!ready && <p className="text-xs text-ink-faint">Enter the measurements above to continue.</p>}
      </div>
    </div>
  )
}

/* ---------------------------------- step 4: as-built ---------------------------------- */
function MapStep() {
  const s = useExisting()
  const built = s.asBuilt && s.asBuilt.ok ? s.asBuilt.value : null
  const fit = useMemo(() => {
    if (!built) return null
    const m = compile(briefFromAnswers(s.answers))
    return { w: m.envelope.width, d: m.envelope.depth, ok: Math.min(built.size.w, built.size.d) <= Math.min(m.envelope.width, m.envelope.depth) && Math.max(built.size.w, built.size.d) <= Math.max(m.envelope.width, m.envelope.depth) }
  }, [built, s.answers])
  if (!s.asBuilt) return <p className="text-sm text-ink-dim">Build the map from the previous step first.</p>
  if (!s.asBuilt.ok) return <div className="border-l-2 border-bad bg-bad/5 p-4 text-sm text-bad" role="alert">{s.asBuilt.error}</div>
  const v = s.asBuilt.value
  const counts = { LOCKED: v.elements.length }
  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div>
        <PlanView elements={v.elements} />
        <div className="mt-3"><PlanLegend /></div>
      </div>
      <div className="space-y-4">
        <div className="border border-line p-4">
          <p className="label flex items-center gap-2"><Lock size={12} /> As-built structural map</p>
          <p className="mt-2 font-display text-3xl">{(v.size.w / 1000).toFixed(1)} × {(v.size.d / 1000).toFixed(1)} m</p>
          <p className="text-sm text-ink-dim">{v.structure.columns.length} columns, {v.structure.beams.length} beams, {v.structure.footings.length} footings, {v.structure.walls.length} walls. All {counts.LOCKED} are LOCKED: they will never be moved or resized.</p>
        </div>
        {fit && (
          <p className={cx('border-l-2 p-3 text-sm', fit.ok ? 'border-ok bg-ok/5 text-ok' : 'border-warn bg-warn/5 text-warn')}>
            {fit.ok ? `It fits inside the buildable area of your plot (${(fit.w / 1000).toFixed(1)} x ${(fit.d / 1000).toFixed(1)} m after setbacks).`
              : `The structure is larger than the buildable area (${(fit.w / 1000).toFixed(1)} x ${(fit.d / 1000).toFixed(1)} m after setbacks). Check the plot size, or expect setback conflicts.`}
          </p>
        )}
        <ul className="space-y-1 text-xs text-ink-dim">{v.notes.map((n) => <li key={n}>· {n}</li>)}</ul>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={() => s.setStep(2)}>Back</Button>
          <Button onClick={() => { s.generate(1); s.setStep(4) }}>Generate the 2D plan <ArrowRight size={13} /></Button>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------- step 5: plan ---------------------------------- */
function PlanStep() {
  const s = useExisting()
  const navigate = useNavigate()
  const [level, setLevel] = useState(0)
  const plan = s.plan
  if (!plan) return <Button onClick={() => s.generate(1)}>Generate the 2D plan</Button>
  if (!plan.ok) return (
    <div className="space-y-4">
      <div className="border-l-2 border-bad bg-bad/5 p-4 text-sm text-bad" role="alert">{plan.reason}</div>
      <p className="text-sm text-ink-dim">Reduce the rooms in step 3, or confirm the structure measurements, then try again.</p>
      <div className="flex gap-3"><Button variant="ghost" onClick={() => s.setStep(2)}>Edit rooms</Button><Button onClick={() => s.generate(s.seed + 1)}>Try another arrangement</Button></div>
    </div>
  )
  const findings = plan.existing.findings
  const baseErrors = plan.rules.findings.filter((f) => f.severity === 'error')
  const floors = plan.design.floors
  const lockedColumns = plan.design.floors[0].columns?.filter((c) => c.state === 'LOCKED').length ?? 0
  const proposedColumns = plan.design.floors[0].columns?.filter((c) => c.state === 'PROPOSED').length ?? 0
  const go = (to: string) => {
    const asBuilt = s.asBuilt && s.asBuilt.ok ? s.asBuilt.value : null
    if (!asBuilt) return
    useStudio.getState().loadExisting(plan.brief, asBuilt.structure, s.seed)
    navigate(to)
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div>
        {floors.length > 1 && (
          <div className="mb-3 flex gap-1.5">
            {floors.map((f) => (
              <button key={f.level} type="button" onClick={() => setLevel(f.level)} className={cx('border px-3 py-1.5 font-mono text-[0.68rem] uppercase tracking-[0.08em]', level === f.level ? 'border-accent text-accent' : 'border-line text-ink-dim')}>{f.name}</button>
            ))}
          </div>
        )}
        <PlanView design={plan.design} level={level} findings={findings} />
        <div className="mt-3"><PlanLegend /></div>
      </div>
      <div className="space-y-4">
        <div className={cx('border-l-2 p-4', plan.valid ? 'border-ok bg-ok/5' : 'border-bad bg-bad/5')} role="status">
          <p className={cx('flex items-center gap-2 font-medium', plan.valid ? 'text-ok' : 'text-bad')}>
            {plan.valid ? <Check size={16} /> : <AlertTriangle size={16} />}{plan.valid ? 'Valid plan around your structure' : 'This arrangement has conflicts'}
          </p>
          <p className="mt-1 text-sm text-ink-dim">{lockedColumns} locked columns kept exactly where they are. {proposedColumns} new columns proposed where walls need them. {plan.passing} of {plan.tried} arrangements tried passed every rule.</p>
        </div>
        <div className="border border-line p-4">
          <p className="label">Checks</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {[['Room overlaps', 'ROOM_OVERLAP'], ['Column and wall conflicts', 'COLUMN_WALL_CONFLICT'], ['Door and window conflicts', 'OPENING'],
              ['Stair connectivity', 'STAIR'], ['Minimum room sizes', 'ROOM_TOO_SMALL'], ['Ventilation', 'NO_VENTILATION'], ['Circulation', 'UNREACHABLE_ROOM'],
              ['Existing structure kept', 'LOCKED']].map(([label, code]) => {
              const failed = findings.some((f) => f.severity === 'error' && f.code.startsWith(code))
              return <li key={label} className="flex items-center gap-2">{failed ? <AlertTriangle size={14} className="text-bad" /> : <Check size={14} className="text-ok" />}<span className={failed ? 'text-bad' : ''}>{label}</span></li>
            })}
          </ul>
        </div>
        {(findings.length > 0 || baseErrors.length > 0) && (
          <div className="max-h-56 overflow-y-auto border border-line p-4 text-xs">
            <p className="label">Details</p>
            <ul className="mt-2 space-y-1.5">
              {findings.map((f, i) => <li key={i} className={f.severity === 'error' ? 'text-bad' : 'text-ink-dim'}>{f.severity === 'error' ? 'Conflict' : 'Note'} · {f.message}</li>)}
              {baseErrors.slice(0, 6).map((f, i) => <li key={`b${i}`} className="text-bad">Rule · {f.message}</li>)}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Button variant="ghost" onClick={() => s.generate(s.seed + 1)}>Try another arrangement</Button>
          <Button variant="ghost" onClick={() => s.setStep(2)}>Edit rooms</Button>
        </div>
        <div className="flex flex-wrap gap-3 border-t border-line pt-4">
          <Button onClick={() => go('/workspace/massing')} disabled={!plan.valid}>Continue to 3D <ArrowRight size={13} /></Button>
          <Button variant="ghost" onClick={() => go('/workspace/plan')} disabled={!plan.valid}>Open the 2D plan sheet</Button>
        </div>
        {!plan.valid && <p className="text-xs text-ink-faint">Resolve the red conflicts (edit rooms or try another arrangement) to continue to 3D.</p>}
      </div>
    </div>
  )
}

export function ExistingMode() {
  const step = useExisting((s) => s.step)
  const busy = useExisting((s) => s.busy)
  const reset = useExisting((s) => s.reset)
  const hasImage = useExisting((s) => !!s.imageUrl)
  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Existing structure mode</p>
          <h1 className="mt-2 font-display text-3xl md:text-4xl">Plan around what is already built</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">Upload a site photo. What is already built becomes locked, and the rooms, walls, doors and stair are planned around it.</p>
        </div>
        <div className="flex gap-3">
          {hasImage && <Button variant="quiet" size="sm" onClick={reset}>Start over</Button>}
          <Link to="/start" className="font-mono text-xs uppercase tracking-[0.12em] text-ink-dim hover:text-ink">Back to start</Link>
        </div>
      </div>
      <div className="mt-6"><Pipeline step={step} /></div>
      <div className="mt-5"><Stepper /></div>
      <div className="mt-7" aria-busy={!!busy}>
        {step === 0 && <PhotoStep />}
        {step === 1 && <DetectStep />}
        {step === 2 && <MeasureStep />}
        {step === 3 && <MapStep />}
        {step === 4 && <PlanStep />}
      </div>
    </div>
  )
}
