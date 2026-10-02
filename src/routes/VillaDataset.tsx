import { useEffect, useRef, useState } from 'react'
import { Download, Maximize2, X } from 'lucide-react'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'

type Sample = { id: string; file: string; image_type: string; building_type: string; style: string;
  building_name: string; title: string; source_url: string | null; creator: string; license: string;
  license_url: string | null; width: number; height: number; prompt: string | null }
const ROOT = '/datasets/modern-villas-v1/'
const TYPES = [['villa-bungalow', 'Villa / bungalow'], ['large-villa', 'Large villa']] as const
const STYLES = [['modern-box', 'Modern Box'], ['contemporary', 'Contemporary'], ['courtyard', 'Courtyard']] as const
export function VillaDataset() {
  const [samples, setSamples] = useState<Sample[]>([])
  const [error, setError] = useState('')
  const [type, setType] = useState('all')
  const [style, setStyle] = useState('all')
  const [expanded, setExpanded] = useState<Sample | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const controller = new AbortController()
    fetch(ROOT + 'manifest.json', { signal: controller.signal }).then(r => {
      if (!r.ok) throw new Error('Dataset could not load'); return r.json()
    }).then(setSamples).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
    return () => controller.abort()
  }, [])
  const visible = samples.filter(s => (type === 'all' || s.building_type === type) &&
    (style === 'all' || s.style === style))
  return <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
    <WorkspaceTabs />
    <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="font-display text-3xl">Villa design dataset</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-dim">Modern Box, Contemporary and Courtyard references for villas and large villas. Real exterior photographs collected from online sources, with attribution and licence details.</p></div>
      <a href={ROOT + 'modern-villas-v1.zip'} download className="flex items-center gap-2 border border-line-strong px-4 py-3 text-sm"><Download size={16} /> Download dataset ZIP</a>
    </div>
    <div className="mt-5 flex flex-wrap gap-3">
      <select aria-label="Villa type" value={type} onChange={e => setType(e.target.value)} className="border border-line bg-bg px-3 py-2"><option value="all">All villa types</option>{TYPES.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select>
      <select aria-label="Architectural style" value={style} onChange={e => setStyle(e.target.value)} className="border border-line bg-bg px-3 py-2"><option value="all">All styles</option>{STYLES.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select>

    </div>
    <p className="mt-3 text-xs text-ink-dim">{visible.length} images shown. Reference groupings do not establish floor area, room layouts or structural validity. Several photographs show different views of the same building.</p>
    {error && <p role="alert" className="mt-4 text-bad">{error}</p>}
    {!samples.length && !error && <p role="status" className="mt-4">Loading dataset...</p>}
    {TYPES.filter(([id]) => type === 'all' || type === id).map(([typeId,typeLabel]) => <section key={typeId} className="mt-8">
      <h2 className="font-display text-2xl">{typeLabel}</h2>
      {STYLES.filter(([id]) => style === 'all' || style === id).map(([styleId,styleLabel]) => {
        const group = visible.filter(s => s.building_type === typeId && s.style === styleId)
        if (!group.length) return null
        return <div key={styleId} className="mt-5"><h3 className="text-lg">{styleLabel} <span className="text-sm text-ink-dim">({group.length})</span></h3>
          <div className="mt-3 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{group.map(s => <figure key={s.id} className="border border-line">
            <button type="button" onClick={() => { setExpanded(s); dialog.current?.showModal() }} aria-label={'Enlarge ' + s.building_name} className="relative block aspect-[4/3] w-full bg-bg-inset">
              <img src={ROOT + s.file} alt={s.building_name + ' - ' + styleLabel} loading="lazy" className="h-full w-full object-contain" />
              <span className="absolute left-2 top-2 bg-bg/90 px-2 py-1 text-xs">Real photograph</span><Maximize2 size={18} className="absolute bottom-3 right-3" />
            </button><figcaption className="space-y-2 p-3"><p className="text-sm">{s.building_name}</p><p className="text-xs text-ink-dim">{s.width} x {s.height} · {s.license}</p>
              <div className="flex gap-4 text-xs"><a download href={ROOT + s.file} className="underline">Download image</a>{s.source_url && <a href={s.source_url} target="_blank" rel="noreferrer" className="underline">Source + attribution</a>}</div>
            </figcaption></figure>)}</div></div>
      })}</section>)}
    <div className="mt-8 flex gap-5 text-sm"><a href={ROOT + 'manifest.csv'} download className="underline">CSV labels</a><a href={ROOT + 'manifest.json'} download className="underline">JSON metadata</a><a href={ROOT + 'LICENSES.md'} className="underline">Image licences</a></div>
    <dialog ref={dialog} aria-label="Villa reference image" className="fixed inset-0 m-auto h-[94dvh] w-[96vw] max-w-none border border-line bg-bg p-4 text-ink backdrop:bg-black/85">
      <div className="flex h-full flex-col gap-3"><div className="flex items-center justify-between"><p>{expanded?.building_name}</p><button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label="Close image" className="border border-line p-3"><X size={20} /></button></div>
        {expanded && <><img src={ROOT + expanded.file} alt={expanded.building_name} className="min-h-0 w-full flex-1 object-contain" /><p className="text-xs text-ink-dim">{expanded.creator + ' · ' + expanded.license}</p></>}
      </div>
    </dialog>
  </div>
}
