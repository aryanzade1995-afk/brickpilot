import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RootState } from '@react-three/fiber';
import { Link } from 'react-router-dom';
import { Upload, Undo2, Redo2, ScanLine, ArrowRight, Check, Image as ImageIcon } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui/Button.tsx';
import { VillaSceneCanvas, AcceptedVillaModel } from '@/components/VillaSceneCanvas.tsx';
import { ReferenceLayer, ReferenceCamera } from '@/components/reference/ReferenceLayer.tsx';
import { ReferenceBase } from '@/components/reference/ReferenceBase.tsx';
import { useStudio } from '@/state/studio.ts';
import { useBlender } from '@/state/blender.ts';
import { useReference } from '@/state/reference.ts';
import { useProjects } from '@/state/projects.ts';
import { parseReferenceSpec, featureSchema, type ReferenceFacadeSpec, type ReferenceSettings } from '@/lib/reference/schema.ts';
import { reconstructFacade } from '@/lib/reference/reconstruct.ts';
import {captureAlignedReference} from '@/lib/reference/capture.ts'
import { compareGeometry, comparePixels } from '@/lib/reference/comparison.ts';
import { loadReferenceImage, uploadReference, uploadCrop, referenceRequest, runReferenceJob, type ReferenceJob } from '@/lib/reference/client.ts';
const FIELD = 'w-full min-w-0 max-w-full min-h-11 border border-line bg-bg px-3 py-2 text-sm focus:outline-2 focus:outline-accent';
function Field({ label, children }: {
    label: string;
    children: ReactNode;
}) { return <label className="grid min-w-0 gap-1.5 text-xs text-ink-dim">{label}{children}</label>; }
function NumberField({ label, value, onChange, min, max, step = .01 }: {
    label: string;
    value: number | null;
    onChange: (n: number | null) => void;
    min?: number;
    max?: number;
    step?: number;
}) { return <Field label={label}><input className={FIELD} type="number" value={value ?? ''} min={min} max={max} step={step} placeholder="Unknown" onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}/></Field>; }
function Toggle({ label, value, onChange }: {
    label: string;
    value: boolean;
    onChange: (v: boolean) => void;
}) { return <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)}/>{label}</label>; }
type Refinement = {
    settings: ReferenceSettings;
    improved: boolean;
    before: number | null;
    after: number | null;
    evaluated: number;
    reason: string;
    changes?: {
        id: string;
        parameter: string;
        delta: number;
    }[];
};
const percent = (n: number | null) => n === null ? 'Not available' : `${Math.round(n * 100)}%`;
export function ReferenceFacadeSection() {
    const result = useStudio(s => s.result), run = useStudio(s => s.run), document = useReference(s => s.document), actions = useReference(), save = useProjects(s => s.save);
    const planId = result?.buildingModel?.planId, accepted = useBlender(s => planId ? s.accepted[planId] : undefined);
    const [error, setError] = useState(''), [health, setHealth] = useState<{
        available: boolean;
        message?: string;
        provider?: string;
    } | null>(null), [job, setJob] = useState<ReferenceJob | null>(null), [selected, setSelected] = useState<string | null>(null), [reviewed, setReviewed] = useState<string|null>(null), [original, setOriginal] = useState(false), [drawing, setDrawing] = useState(false), [markType, setMarkType] = useState('frame'), [drag, setDrag] = useState<{
        u: number;
        v: number;
        w: number;
        h: number;
    } | null>(null), [drawStart, setDrawStart] = useState<[
        number,
        number
    ] | null>(null);
    const [mark, setMark] = useState({ u: .1, v: .1, w: .2, h: .3 }), [depth, setDepth] = useState<number | null>(null), [refinement, setRefinement] = useState<Refinement | null>(null), [candidatePreview, setCandidatePreview] = useState(false), [metrics, setMetrics] = useState<(ReturnType<typeof comparePixels> & {
        signature: string;
    }) | null>(null), [files, setFiles] = useState<{
        signature: string;
        urls: Record<string, string>;
    } | null>(null), [quality, setQuality] = useState<'preview' | 'final'>('preview'), [uploaded, setUploaded] = useState(false);
    const controller = useRef<AbortController | null>(null), root = useRef<RootState | null>(null), fileInput = useRef<HTMLInputElement>(null);
    useEffect(() => { if (!result)
        run(); }, [result, run]);
    useEffect(() => { if (planId && !useReference.getState().document)
        useReference.getState().open(planId); }, [planId]);
    useEffect(() => { let live = true; void referenceRequest<{
        available: boolean;
        message?: string;
        provider?: string;
    }>('/api/reference/health').then(v => { if (live)
        setHealth(v); }).catch(() => { if (live)
        setHealth({ available: false, message: 'Analysis service unavailable. Manual marking still works.' }); }); return () => { live = false; controller.current?.abort(); }; }, []);
    const doc = document?.sourcePlanId === planId ? document : null, spec = doc?.spec, settings = doc?.settings;
    const computed = useMemo(() => { if (!result?.buildingModel || !spec || !settings)
        return { geometry: null, error: '' }; try {
        return { geometry: reconstructFacade(result.buildingModel, spec, settings), error: '' };
    }
    catch (e) {
        return { geometry: null, error: e instanceof Error ? e.message : 'Invalid facade dimensions' };
    } }, [result, spec, settings]);
    const geometry = computed.geometry, comparison = useMemo(() => geometry && spec && settings ? compareGeometry(spec, geometry, settings) : null, [geometry, spec, settings]);
    const busy = job?.status === 'running' || job?.status === 'queued', aspect = spec ? spec.source.imageWidth * spec.source.crop.w / (spec.source.imageHeight * spec.source.crop.h) : 4 / 3;
    const previewSettings = candidatePreview && refinement?.improved ? refinement.settings : settings;
    const previewGeometry = useMemo(() => { if (!candidatePreview || !refinement?.improved || !result?.buildingModel || !spec)
        return geometry; try {
        return reconstructFacade(result.buildingModel, spec, refinement.settings);
    }
    catch {
        return geometry;
    } }, [candidatePreview, refinement, result, spec, geometry]);
    const currentMetrics = metrics?.signature === geometry?.signature && !original && !candidatePreview ? metrics : null;
    const active = spec ? [...spec.volumes, ...spec.openings, ...spec.features].find(x => x.id === selected) : undefined, edit = selected ? settings?.edits[selected] : undefined;
    const guard = (work: () => void) => { try {
        setError('');
        setReviewed(null);
        work();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to update the facade.');
    } };
    const update = (patch: Partial<ReferenceSettings>) => guard(() => { setCandidatePreview(false); setRefinement(null); actions.settings(patch); });
    const setSpec = (next: ReferenceFacadeSpec) => guard(() => actions.setSpec(parseReferenceSpec(next)));
    const initialize = (id: string, width: number, height: number) => { const current = useReference.getState().document; if (!current || current.spec)
        return; actions.setSpec({ version: 1, source: { imageHash: id, imageWidth: width, imageHeight: height, mimeType: 'image/png', crop: { u: 0, v: 0, w: 1, h: 1 }, provider: 'manual', cameraView: 'unknown' }, envelope: { widthHeightRatio: width / height, floorCount: result?.buildingModel?.floors.length ?? 1, confidence: 0 }, camera: { azimuthDeg: null, elevationDeg: null, focalLengthMm: null }, volumes: [], openings: [], features: [], materials: [{ id: 'plaster', type: 'plaster', color: '#E9E3D7', roughness: .8, metallic: 0, confidence: 0 }, { id: 'accent', type: 'wood', color: '#80614A', roughness: .65, metallic: 0, confidence: 0 }], assumptions: ['Manual observation: no automatic image analysis has been performed.', 'Palette is illustrative until reviewed; depth is not measurable from one image.'] }); };
    const upload = async (file: File) => { try {
        setError('');
        setUploaded(true);
        const image = await uploadReference(file);
        if (useStudio.getState().result?.buildingModel?.planId !== planId)
            return;
        actions.image(image.id);
        initialize(image.id, image.width, image.height);
        setFiles(null);
        setSelected(null);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Image upload failed.');
    }
    finally {
        setUploaded(false);
    } };
    const task = async (kind: 'analysis' | 'reconstruct' | 'refine' | 'export') => {
        if (!spec || !settings || !result)
            return;
        setError('');
        const c = new AbortController();
        controller.current?.abort();
        controller.current = c;
        setJob({ id: '', kind, status: 'running', stage: kind === 'analysis' ? 'Preparing selected facade crop' : 'Validating request' });
        const sourceDocument = useReference.getState().document;
        try {
            const crop = kind === 'analysis' ? await uploadCrop(spec) : null;
            const value = await runReferenceJob({ kind, ...(kind === 'analysis' ? { imageId: spec.source.imageHash, analysisImageId: crop!.id, crop: spec.source.crop, cameraView: spec.source.cameraView } : { design: result.design, spec, settings, quality, ...(kind === 'export' && accepted ? { acceptedUrl: accepted.files.glb } : {}) }) }, setJob, c.signal);
            if (useReference.getState().document !== sourceDocument) {
                setError('The project or reference changed during this operation. The result was not applied. Retry with the current settings.');
                return;
            }
            if (kind === 'analysis') {
                actions.setSpec(parseReferenceSpec(value.spec));
                setReviewed(null);
            }
            if (kind === 'refine')
                setRefinement(value as Refinement);
            if (kind === 'export')
                setFiles({ signature: geometry!.signature, urls: value.files as Record<string, string> });
        }
        catch (e) {
            if (!c.signal.aborted)
                setError(e instanceof Error ? e.message : 'Reference operation failed.');
            setJob(j => j ? { ...j, status: c.signal.aborted ? 'cancelled' : 'failed', stage: c.signal.aborted ? 'Cancelled' : 'Needs attention' } : null);
        }
    };
    const addMark = (rect = mark) => {
        if (!spec)
            return;
        guard(() => {
            const id = `component_${Date.now().toString(36)}`, shared = { id, rect, confidence: 1, evidence: 'manual' as const, materialId: 'plaster', depthRatio: depth };
            const next = structuredClone(spec);
            if (markType === 'volume')
                next.volumes.push({ ...shared, type: 'main', parentId: null, frontOffsetRatio: null });
            else if (['window', 'door', 'sliding-door'].includes(markType)) {
                if (!next.volumes.length)
                    throw new Error('Mark a host volume before an opening.');
                next.openings.push({ ...shared, type: markType as 'window' | 'door' | 'sliding-door', hostId: next.volumes[0].id });
            }
            else
                next.features.push({ ...shared, type: featureSchema.shape.type.parse(markType), hostId: next.volumes[0]?.id ?? null, count: 6, thicknessRatio: .015 });
            actions.setSpec(parseReferenceSpec(next));
            setSelected(id);
            setDrawing(false);
        });
    };
    const changeEdit = (key: string, n: number | null) => { if (!selected || !settings)
        return; const entry = { ...settings.edits[selected] }; if (n === null)
        delete entry[key as keyof typeof entry];
    else
        Object.assign(entry, { [key]: n }); update({ edits: { ...settings.edits, [selected]: entry } }); };
    const remove = () => { if (!spec || !selected)
        return; setSpec({ ...spec, volumes: spec.volumes.filter(x => x.id !== selected && x.parentId !== selected), features: spec.features.filter(x => x.id !== selected && x.hostId !== selected), openings: spec.openings.filter(x => x.id !== selected && x.hostId !== selected) }); setSelected(null); };
    const compare = async () => { try {
        if (!root.current || !spec)
            throw new Error('Open the 3D preview first.');
        setError('');
        const r = root.current;

        const image = await loadReferenceImage(`/api/reference/images/${spec.source.imageHash}`), render=captureAlignedReference(r,geometry!,settings!,aspect), w=render.width,h=render.height,a = documentCanvas(w, h), b = documentCanvas(w, h), c = spec.source.crop;
        a.getContext('2d')!.drawImage(image, image.naturalWidth * c.u, image.naturalHeight * c.v, image.naturalWidth * c.w, image.naturalHeight * c.h, 0, 0, w, h);
        b.getContext('2d')!.drawImage(render, 0, 0, w, h);
        setMetrics({ ...comparePixels(a.getContext('2d')!.getImageData(0, 0, w, h).data, b.getContext('2d')!.getImageData(0, 0, w, h).data, w, h), signature: geometry!.signature });
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Comparison failed.');
    } };
    if (!result)
        return <p className="py-12 text-sm text-ink-dim">Preparing your source plan…</p>;
    if (!result.report.hardChecksPass)
        return <p className="py-8 text-sm text-ink-dim">Resolve the source plan’s mandatory checks before reconstructing a facade.</p>;
    if (document && planId && document.sourcePlanId !== planId)
        return <section className="mt-10 border-t border-line py-8"><h2 className="font-display text-2xl">Reference facade · source house changed</h2><p className="my-4 max-w-xl text-sm text-ink-dim">Your previous reference is retained, but cannot be applied to this different plan. Reopen its saved project or start a new reference for the current house. Undo retains the previous reference during this session.</p><Button onClick={()=>actions.open(planId)}>Start reference for current house</Button><ButtonLink to="/designs" variant="quiet">Saved projects</ButtonLink></section>;
    return <section aria-labelledby="reference-facade-title" className="mt-10 border-t border-line py-8">
  <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6"><div><p className="font-mono text-xs uppercase tracking-[.16em] text-accent">Reference studio</p><h2 id="reference-facade-title" className="mt-2 font-display text-3xl">Reference facade</h2><p className="mt-2 max-w-xl text-sm text-ink-dim">Build from what you can see. Keep your accepted house, and review every assumption.</p></div><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => save({ label: 'Reference facade saved' })}>Save project</Button><ButtonLink to="/workspace/massing" variant="quiet">View villa <ArrowRight size={15}/></ButtonLink></div></header>
  {(error || computed.error) && <p role="alert" className="my-4 border border-red-300 bg-red-50 p-4 text-sm text-red-900">{error || computed.error}</p>}
  <div className="mt-6 grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[310px_minmax(0,1fr)]">
   <aside className="grid min-w-0 gap-5">
    <section className="border border-line p-5"><h2 className="font-display text-lg">01 · Reference image</h2><button className="mt-4 grid min-h-28 w-full place-items-center gap-2 border border-dashed border-line-strong bg-bg-inset p-4 text-sm hover:border-accent" onClick={() => fileInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file)
        void upload(file); }} disabled={uploaded || busy}><Upload size={20}/>{uploaded ? 'Uploading…' : spec ? 'Replace photograph' : 'Drop or choose a photograph'}<span className="text-xs text-ink-faint">JPEG, PNG, WebP · up to 8 MB</span></button><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Upload reference photograph" onChange={e => { const f = e.target.files?.[0]; if (f)
        void upload(f); e.target.value = ''; }}/>
     <p className="mt-3 text-xs text-ink-dim">{health?.available ? `${health.provider} · vision analysis available` : 'Manual marking available · vision is offline or unconfigured'}</p>
     {spec && <><p className="mt-2 font-mono text-xs text-ink-faint">{spec.source.imageWidth} × {spec.source.imageHeight} · {spec.source.provider}</p><details className="mt-4 text-sm"><summary className="min-h-11 cursor-pointer py-2">Primary facade crop</summary><p className="mb-3 text-xs text-ink-dim">Fractions of the full image. Changing crop clears prior observations.</p><div className="grid grid-cols-2 gap-2">{(['u', 'v', 'w', 'h'] as const).map(k => <NumberField key={k} label={{ u: 'Left', v: 'Top', w: 'Width', h: 'Height' }[k]} value={spec.source.crop[k]} min={0} max={1} onChange={n => { if (n === null)
            return; setSpec({ ...spec, source: { ...spec.source, crop: { ...spec.source.crop, [k]: n } }, features: [], volumes: [], openings: [] }); setMetrics(null); }}/>)}</div></details>
      <Field label="Approximate photograph viewpoint"><select className={FIELD} value={spec.source.cameraView} onChange={e => setSpec({ ...spec, source: { ...spec.source, cameraView: e.target.value as ReferenceFacadeSpec['source']['cameraView'] } })}>{['unknown', 'front', 'left-oblique', 'right-oblique'].map(v => <option key={v}>{v}</option>)}</select></Field>
      <Button className="mt-3 w-full" variant="quiet" disabled={busy} onClick={()=>{actions.remove();setFiles(null);setSelected(null)}}>Remove reference · undo available</Button><Button className="mt-3 w-full" disabled={busy || !health?.available} onClick={() => void task('analysis')}><ScanLine size={15}/>Analyze facade</Button></>}
    </section>
    {spec && settings && <><section className="grid gap-3 border border-line p-5"><h2 className="font-display text-lg">02 · Design intent</h2><Field label="Operation"><select className={FIELD} value={settings.operation} onChange={e => update({ operation: e.target.value as ReferenceSettings['operation'] })}><option value="reconstruction">Reference reconstruction</option><option value="style-transfer">Style transfer · appearance only</option></select></Field>
     <Field label="Architecture"><select className={FIELD} value={settings.mode} disabled={settings.operation==='style-transfer'} onChange={e => update({ mode: e.target.value as ReferenceSettings['mode'] })}><option value="preserve-plan">Preserve my current plan</option><option value="reference-led">Propose a reference-led envelope</option></select></Field>
     <p className="text-xs leading-relaxed text-ink-dim">{settings.operation === 'style-transfer' ? 'Only material appearance changes; no new solids or openings.' : settings.mode === 'preserve-plan' ? 'Rooms, floors, stairs and real openings stay fixed. Incompatible additions are blocked.' : 'A separate exterior study. Room planning, structure, access and services must be reconciled before it becomes a house plan.'}</p>
     <div className="grid grid-cols-2 gap-2"><Field label="Facade side"><select className={FIELD} value={settings.side} onChange={e => update({ side: e.target.value as ReferenceSettings['side'] })}>{['N', 'E', 'S', 'W'].map(v => <option key={v}>{v}</option>)}</select></Field><NumberField label="Visible floors" step={1} min={1} max={4} value={spec.envelope.floorCount} onChange={n => n !== null && setSpec({ ...spec, envelope: { ...spec.envelope, floorCount: n } })}/></div>
     <details><summary className="min-h-11 cursor-pointer py-2 text-sm">Known dimensions (optional)</summary><div className="grid gap-2">{(['knownWidthMm', 'knownHeightMm', 'depthMm'] as const).map(k => <NumberField key={k} label={{ knownWidthMm: 'Facade width · mm', knownHeightMm: 'Facade height · mm', depthMm: 'Envelope depth · mm' }[k]} value={settings[k]} step={100} onChange={n => update({ [k]: n })}/>)}</div></details>
    </section>
    <section className="grid gap-3 border border-line p-5"><h2 className="font-display text-lg">03 · Mark visible features</h2><p className="text-xs leading-relaxed text-ink-dim">Draw on the photograph or enter a rectangle. Nothing is detected automatically in manual mode.</p><Field label="Component"><select className={FIELD} value={markType} onChange={e => setMarkType(e.target.value)}><option value="volume">Building volume</option>{featureSchema.shape.type.options.map(v => <option key={v}>{v}</option>)}{['window', 'door', 'sliding-door'].map(v => <option key={v}>{v}</option>)}</select></Field>
     <NumberField label="Projection / depth · fraction of facade width" value={depth} min={.001} max={.5} onChange={setDepth}/><Button variant={drawing ? 'primary' : 'ghost'} onClick={() => setDrawing(!drawing)}>{drawing ? 'Cancel drawing' : 'Draw rectangle on image'}</Button>
     <details><summary className="min-h-11 cursor-pointer py-2 text-sm">Enter rectangle numerically</summary><div className="grid grid-cols-2 gap-2">{(['u', 'v', 'w', 'h'] as const).map(k => <NumberField key={k} label={{ u: 'Left', v: 'Top', w: 'Width', h: 'Height' }[k]} value={mark[k]} min={0} max={1} onChange={n => n !== null && setMark({ ...mark, [k]: n })}/>)}</div><Button variant="ghost" className="mt-2 w-full" onClick={() => addMark()}>Add marked component</Button></details>
    </section></>}
   </aside>
   <div className="min-w-0 space-y-5">
    {!spec && <div className="grid min-h-96 place-content-center gap-4 border border-line bg-bg-inset p-8 text-center"><ImageIcon className="mx-auto text-accent" size={32}/><h2 className="font-display text-2xl">Start with your reference.</h2><p className="max-w-md text-sm text-ink-dim">Upload a house photograph, isolate its facade, then analyze it or mark its visible geometry yourself.</p>{actions.past.length>0&&<Button variant="ghost" onClick={()=>actions.undo()}>Undo last reference change</Button>}{doc?.imageId && <img className="mx-auto max-h-40" src={`/api/reference/images/${doc.imageId}`} alt="Saved reference" onLoad={e => initialize(doc.imageId!, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}/>}</div>}
    {spec && settings && <><div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2"><section className="border border-line"><div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2"><h2 className="font-mono text-xs uppercase tracking-wider">Reference · {drawing ? 'draw a rectangle' : 'observations'}</h2><span className="text-xs text-ink-dim">{spec.features.length} features</span></div>
     <svg role="img" aria-label="Reference photograph and editable observations" className={drawing ? 'w-full touch-none cursor-crosshair' : 'w-full'} viewBox="0 0 1000 1000" style={{ aspectRatio: aspect }} preserveAspectRatio="none" onPointerDown={e => { if (!drawing)
            return; e.currentTarget.setPointerCapture(e.pointerId); const box = e.currentTarget.getBoundingClientRect(); const p: [
            number,
            number
        ] = [(e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height]; setDrawStart(p); setDrag({ u: p[0], v: p[1], w: 0, h: 0 }); }} onPointerMove={e => { if (!drawing || !drawStart)
            return; const box = e.currentTarget.getBoundingClientRect(), x = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)), y = Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)); setDrag({ u: Math.min(x, drawStart[0]), v: Math.min(y, drawStart[1]), w: Math.abs(x - drawStart[0]), h: Math.abs(y - drawStart[1]) }); }} onPointerUp={() => { if (drawing && drag && drag.w > .005 && drag.h > .005) {
            setMark(drag);
            addMark(drag);
        } setDrawStart(null); setDrag(null); }} onPointerCancel={() => { setDrawStart(null); setDrag(null); }}>
      <svg x="0" y="0" width="1000" height="1000" viewBox={`${spec.source.crop.u * spec.source.imageWidth} ${spec.source.crop.v * spec.source.imageHeight} ${spec.source.crop.w * spec.source.imageWidth} ${spec.source.crop.h * spec.source.imageHeight}`} preserveAspectRatio="none"><image href={`/api/reference/images/${spec.source.imageHash}`} width={spec.source.imageWidth} height={spec.source.imageHeight} onError={()=>setError('Stored reference photograph is unavailable. Replace it; your saved geometry is retained.')}/></svg>
      {[...spec.volumes, ...spec.openings, ...spec.features].map(item => <g key={item.id} onClick={() => setSelected(item.id)}><rect x={item.rect.u * 1000} y={item.rect.v * 1000} width={item.rect.w * 1000} height={item.rect.h * 1000} fill={selected === item.id ? '#49756135' : 'transparent'} stroke={selected === item.id ? '#ffde8b' : '#faf7ec'} strokeWidth="3" vectorEffect="non-scaling-stroke"/><text x={item.rect.u * 1000 + 6} y={item.rect.v * 1000 + 23} fill="white" stroke="#252521" strokeWidth=".5" fontSize="21">{item.type}</text></g>)}
      {drag && <rect x={drag.u * 1000} y={drag.v * 1000} width={drag.w * 1000} height={drag.h * 1000} stroke="#f6ce78" strokeWidth="4" fill="#f6ce7833"/>}
     </svg></section>
     <section className="border border-line"><div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2"><h2 className="font-mono text-xs uppercase tracking-wider">{original ? 'Original house' : candidatePreview ? 'Candidate preview' : 'Geometry preview'}</h2><button className="min-h-11 text-xs underline" onClick={() => setOriginal(!original)}>{original ? 'Show proposal' : 'Compare original'}</button></div><div style={{ aspectRatio: aspect }}>{previewGeometry && previewSettings && <VillaSceneCanvas onCreated={state => { root.current = state; }}>{(original || settings.showBuilding) && (original || settings.mode === 'preserve-plan' || settings.operation === 'style-transfer') && (accepted ? <AcceptedVillaModel url={accepted.files.glb} fit={false} style={!original && settings.showReference && settings.operation === 'style-transfer' ? previewGeometry.style : undefined}/> : <ReferenceBase design={result.design} style={!original && settings.showReference && settings.operation === 'style-transfer' ? previewGeometry.style : undefined}/>)}{!original && settings.showReference && <ReferenceLayer geometry={previewGeometry} selected={selected} onSelect={setSelected}/>}<ReferenceCamera geometry={previewGeometry} settings={previewSettings}/></VillaSceneCanvas>}</div><p className="border-t border-line px-4 py-2 text-xs text-ink-faint">{accepted ? 'Your accepted Blender villa' : 'Existing architectural study · no accepted Blender model yet'} · drag to orbit</p></section>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border border-line px-4 py-2"><div className="flex flex-wrap gap-4">{settings.mode==='preserve-plan'||settings.operation==='style-transfer'?<Toggle label="Source building" value={settings.showBuilding} onChange={showBuilding => update({ showBuilding })}/>:<span className="self-center text-xs text-ink-dim">Separate envelope study · compare the original above</span>}<Toggle label="Reference proposal" value={settings.showReference} onChange={showReference => update({ showReference })}/></div><div className="flex flex-wrap gap-2"><Button variant="quiet" disabled={!actions.past.length} onClick={() => actions.undo()}><Undo2 size={15}/>Undo</Button><Button variant="quiet" disabled={!actions.future.length} onClick={() => actions.redo()}><Redo2 size={15}/>Redo</Button><Button variant="ghost" disabled={!doc?.accepted} onClick={() => actions.reset()}>Reset to accepted</Button></div></div>
    <div className="grid gap-5 lg:grid-cols-2"><section className="border border-line p-5"><h2 className="font-display text-lg">Component editor</h2><Field label="Select geometry"><select className={`${FIELD} mt-3`} value={selected ?? ''} onChange={e => setSelected(e.target.value || null)}><option value="">Choose a component</option>{[...spec.volumes, ...spec.openings, ...spec.features].map(x => <option key={x.id} value={x.id}>{x.type} · {x.id}</option>)}</select></Field>
     {active && <>{'parentId' in active && <><Field label="Volume type"><select className={FIELD} value={active.type} onChange={e => setSpec({ ...spec, volumes: spec.volumes.map(x => x.id === active.id ? { ...x, type: e.target.value as 'main' | 'projection' | 'recess' | 'setback' } : x) })}>{['main', 'projection', 'recess', 'setback'].map(v => <option key={v}>{v}</option>)}</select></Field><Field label="Parent volume"><select className={FIELD} value={active.parentId ?? ''} onChange={e => setSpec({ ...spec, volumes: spec.volumes.map(x => x.id === active.id ? { ...x, parentId: e.target.value || null } : x) })}><option value="">Facade datum</option>{spec.volumes.filter(x => x.id !== active.id).map(x => <option key={x.id} value={x.id}>{x.id}</option>)}</select></Field><NumberField label="Front offset / facade width · signed from parent" value={active.frontOffsetRatio} min={-.5} max={.5} onChange={n => setSpec({ ...spec, volumes: spec.volumes.map(x => x.id === active.id ? { ...x, frontOffsetRatio: n } : x) })}/></>}{'count' in active && <div className="mt-3 grid grid-cols-2 gap-3"><NumberField label="Repetitions" min={1} max={24} step={1} value={active.count} onChange={n => n !== null && setSpec({ ...spec, features: spec.features.map(x => x.id === active.id ? { ...x, count: n } : x) })}/><NumberField label="Member width / facade width" min={.005} max={.15} value={active.thicknessRatio} onChange={n => n !== null && setSpec({ ...spec, features: spec.features.map(x => x.id === active.id ? { ...x, thicknessRatio: n } : x) })}/></div>}{'hostId' in active && <Field label="Host volume"><select className={FIELD} value={active.hostId ?? ''} onChange={e => { const next = structuredClone(spec), item = [...next.features, ...next.openings].find(x => x.id === active.id)!; item.hostId = e.target.value || null; setSpec(next); }}><option value="">Source facade</option>{spec.volumes.map(v => <option key={v.id} value={v.id}>{v.id}</option>)}</select></Field>}<p className="my-3 text-xs text-ink-dim">{active.evidence} · confidence {percent(active.confidence)} · {geometry?.parts.filter(x => x.ownerId === active.id).length ?? 0} solid parts</p><div className="grid grid-cols-2 gap-3"><NumberField label="Horizontal offset · fraction" value={edit?.uDelta ?? 0} min={-.5} max={.5} onChange={n => changeEdit('uDelta', n)}/><NumberField label="Vertical offset · fraction" value={edit?.vDelta ?? 0} min={-.5} max={.5} onChange={n => changeEdit('vDelta', n)}/><NumberField label="Width multiplier" value={edit?.widthScale ?? 1} min={.25} max={2} onChange={n => changeEdit('widthScale', n)}/><NumberField label="Height multiplier" value={edit?.heightScale ?? 1} min={.25} max={2} onChange={n => changeEdit('heightScale', n)}/><NumberField label="Depth / facade width" value={edit?.depthRatio ?? active.depthRatio} min={.001} max={.5} onChange={n => changeEdit('depthRatio', n)}/><Field label="Material"><select className={FIELD} value={active.materialId ?? ''} onChange={e => { const next = structuredClone(spec); const item = [...next.volumes, ...next.openings, ...next.features].find(x => x.id === active.id)!; item.materialId = e.target.value || null; setSpec(next); }}><option value="">Illustrative plaster</option>{spec.materials.map(x => <option key={x.id} value={x.id}>{x.type} · {x.id}</option>)}</select></Field></div>
      <p className="mt-3 font-mono text-xs text-ink-dim">Image rectangle {Object.values(active.rect).map(v => v.toFixed(3)).join(' / ')} · {geometry?.parts.filter(x => x.ownerId === active.id).map(x => x.sizeMm.join(' × ') + ' mm').slice(0, 4).join('; ')}</p><Button variant="quiet" className="mt-2" onClick={remove}>Remove component</Button></>}
     <details className="mt-4"><summary className="min-h-11 cursor-pointer py-2 text-sm">Facade palette</summary><div className="grid gap-3">{spec.materials.map(m => <div key={m.id} className="grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2"><Field label={m.type}><input aria-label={`${m.id} colour`} className="h-11 w-11 border border-line" type="color" value={m.color} onChange={e => setSpec({ ...spec, materials: spec.materials.map(x => x.id === m.id ? { ...x, color: e.target.value } : x) })}/></Field><NumberField label="Roughness" min={0} max={1} value={m.roughness} onChange={n => n !== null && setSpec({ ...spec, materials: spec.materials.map(x => x.id === m.id ? { ...x, roughness: n } : x) })}/><NumberField label="Metalness" min={0} max={1} value={m.metallic} onChange={n => n !== null && setSpec({ ...spec, materials: spec.materials.map(x => x.id === m.id ? { ...x, metallic: n } : x) })}/></div>)}</div></details>
    </section>
    <section className="border border-line p-5"><h2 className="font-display text-lg">Camera & comparison</h2>{Object.values(spec.camera).some(v => v !== null) && <Button variant="quiet" onClick={() => update({ ...Object.fromEntries(Object.entries(spec.camera).filter(([, v]) => v !== null)) })}>Use estimated camera</Button>}<div className="mt-4 grid grid-cols-2 gap-3">{(['azimuthDeg', 'elevationDeg', 'focalLengthMm', 'framing'] as const).map(k => <NumberField key={k} label={{ azimuthDeg: 'Azimuth · degrees', elevationDeg: 'Elevation · degrees', focalLengthMm: 'Focal length · mm', framing: 'Framing multiplier' }[k]} value={settings[k]} step={k === 'framing' ? .05 : 1} onChange={n => n !== null && update({ [k]: n })}/>)}</div><div className="mt-4 flex flex-wrap gap-2"><Button variant="ghost" onClick={() => void compare()} disabled={busy || !geometry || original || candidatePreview}>Compare aligned render</Button><Button variant="ghost" onClick={() => void task('refine')} disabled={busy || !spec.features.length || geometry?.status === 'rejected'}>Suggest refinement</Button></div>
     <div className="mt-4 grid grid-cols-3 gap-2 border-y border-line py-3">{[['Feature fit', percent(comparison?.objective ?? null)], ['Edge match', percent(currentMetrics?.edgeF1 ?? null)], ['Tone similarity', percent(currentMetrics?.globalToneSimilarity ?? null)]].map(([label, value]) => <div key={label}><p className="text-xs text-ink-faint">{label}</p><p className="mt-1 font-display text-xl">{value}</p></div>)}</div><p className="mt-3 text-xs leading-relaxed text-ink-dim">Scores depend on crop, camera, lighting and background. They measure visual agreement, not architectural correctness. Refinement tests bounded solid-geometry candidates against fixed observations.</p>
     {comparison?.mismatches.slice(0, 4).map(m => <button key={m.id} className="mt-2 min-h-11 w-full border-b border-line py-2 text-left text-xs" onClick={() => setSelected(m.id)}>{m.id} · {percent(m.iou)}<br />{m.suggestion}</button>)}
     {refinement && <div className="mt-3 border border-accent bg-bg-inset p-3 text-sm"><p>{refinement.reason}</p><p className="mt-2 text-xs">{refinement.evaluated} candidates · {percent(refinement.before)} → {percent(refinement.after)}</p>{refinement.changes?.map(c => <p key={c.id + c.parameter} className="mt-1 font-mono text-xs">{c.id}: {c.parameter} {c.delta > 0 ? '+' : ''}{c.delta}</p>)}<div className="mt-3 flex flex-wrap gap-2"><Button variant="ghost" disabled={!refinement.improved} onClick={() => setCandidatePreview(!candidatePreview)}>{candidatePreview ? 'Return to current' : 'Preview candidate'}</Button><Button disabled={!refinement.improved} onClick={() => { update(refinement.settings); setRefinement(null); }}>Apply candidate</Button><Button variant="quiet" onClick={() => { setRefinement(null); setCandidatePreview(false); }}>Reject</Button></div></div>}
    </section></div>
    <section className="border border-line p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-xl">Validation & acceptance</h2><span className={`font-mono text-xs uppercase ${geometry?.status === 'rejected' ? 'text-red-700' : 'text-accent'}`}>{geometry?.status ?? 'Invalid specification'} · {geometry?.parts.length ?? 0} parts</span></div>
     <div className="mt-4 max-h-64 space-y-2 overflow-auto">{geometry?.issues.map((issue, i) => <button key={i} className={`block w-full border-l-2 px-3 py-2 text-left text-sm ${issue.severity === 'error' ? 'border-red-500 bg-red-50' : 'border-amber-500 bg-bg-inset'}`} onClick={() => setSelected(issue.componentId)}><span className="font-medium">{issue.severity === 'error' ? 'Fix required' : 'Review'} · {issue.message}</span><span className="mt-1 block text-xs text-ink-dim">{issue.correction}</span></button>)}{geometry && !geometry.issues.length && <p className="text-sm text-accent">Geometry checks passed. Professional review is still required.</p>}</div>
     <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm">Assumptions & scope</summary><ul className="space-y-2 pl-4 text-xs text-ink-dim">{geometry?.qualifications.map((q, i) => <li key={i}>{q}</li>)}</ul></details>
     <Toggle label={settings.mode === 'reference-led' ? 'I understand this is an exterior study requiring plan reconciliation.' : 'I have reviewed the visible geometry and unresolved assumptions.'} value={!!geometry&&reviewed===geometry.signature} onChange={value=>setReviewed(value?geometry?.signature??null:null)}/>
     <div className="mt-3 flex flex-wrap gap-2"><Button disabled={busy || !geometry || geometry.status === 'rejected' || reviewed!==geometry.signature || (settings.operation === 'reconstruction' && !geometry.parts.length)} onClick={() => { actions.accept(geometry!.signature); setOriginal(false); save({ label: 'Reference facade accepted' }); }}><Check size={16}/>Accept {settings.mode === 'reference-led' ? 'exterior study' : 'facade'}</Button><Button variant="ghost" disabled={!doc?.accepted} onClick={() => {if(doc?.enabled){actions.enabled(false);setOriginal(true)}else{actions.reset();setOriginal(false)}}}>{doc?.enabled ? 'Return to original' : 'Restore accepted facade'}</Button><Button variant="quiet" disabled={busy} onClick={() => void task('reconstruct')}>Check on server</Button></div>
    </section>
    <section className="flex flex-wrap items-end justify-between gap-4 border border-line p-5"><div><h2 className="font-display text-xl">Editable Blender delivery</h2><p className="mt-2 max-w-xl text-xs text-ink-dim">Exports the same solid dimensions and material parameters. Preserved-plan exports include your accepted villa when available. Reference-led exports are explicitly an exterior study.</p></div><div className="flex flex-wrap gap-2"><Field label="Render quality"><select className={FIELD} value={quality} onChange={e => setQuality(e.target.value as 'preview' | 'final')}><option value="preview">Preview · Eevee</option><option value="final">Final · Cycles</option></select></Field><Button className="self-end" disabled={busy || !geometry || geometry.status === 'rejected'} onClick={() => void task('export')}>Build export</Button></div>{files && <div className="w-full border-t border-line pt-3">{files.signature !== geometry?.signature && <p className="mb-3 text-sm text-amber-800">Previous export · settings have changed. Rebuild before delivery.</p>}<div className="flex flex-wrap gap-4">{Object.entries(files.urls).map(([ext, url]) => <a className="min-h-11 py-2 font-mono text-xs uppercase underline" key={ext} href={url} download>Download .{ext}</a>)}</div></div>}</section>
    {busy && <div role="status" className="sticky bottom-4 flex items-center justify-between gap-4 border border-accent bg-bg px-5 py-3 shadow-lg"><p className="text-sm"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent"/>{job?.stage}</p><Button variant="quiet" onClick={() => controller.current?.abort()}>Cancel</Button></div>}
    </>}
   </div>
  </div><footer className="mt-6 border-t border-line pt-4 text-xs text-ink-faint">Your original rooms, accepted building and estimates stay intact. <Link className="underline" to="/workspace/plan#floor-plan">Back to floor plan</Link></footer>
 </section>;
}
function documentCanvas(w: number, h: number) { const c = globalThis.document.createElement('canvas'); c.width = w; c.height = h; return c; }
