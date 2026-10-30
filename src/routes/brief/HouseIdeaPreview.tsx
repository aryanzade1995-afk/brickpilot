import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { translate as t, useLanguage } from '@/lib/i18n/index.ts'
import { useStudio } from '@/state/studio.ts'
import { houseIdeaKey, houseIdeaSelection, type HouseIdeaManifest } from '@/lib/gallery/houseIdeas.ts'
import { modernCompositionTitle, type ModernComposition } from '@/lib/model/modernCompositions.ts'

const STYLE_LABELS: Record<string, string> = { 'modern-box': 'Modern Box', 'contemporary-indian': 'Contemporary', 'courtyard-indian': 'Courtyard' }
const LAYOUT_LABELS: Record<string, string> = { auto: 'Auto', 'twin-wing': 'Twin wings', 'u-wing': 'U wings', 'courtyard-ring': 'Courtyard wings', pavilion: 'Pavilion' }

export function HouseIdeaPreview() {
  useLanguage(s => s.language)
  const brief = useStudio(s => s.brief)
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1023px)').matches)
  const [gallery, setGallery] = useState<HouseIdeaManifest | null>(null)
  const [error, setError] = useState(false)
  const [failedImage, setFailedImage] = useState('')
  // Static assets only: switching choices never starts Blender, compiles a plan,
  // accesses a saved render or changes the current project's identity.
  useEffect(() => {
    const abort = new AbortController()
    void fetch('/house-ideas/manifest.json', { signal: abort.signal, cache: 'no-cache' }).then(response => {
      if (!response.ok) throw new Error('Image library unavailable')
      return response.json()
    }).then((value: HouseIdeaManifest) => {
      if (value.schemaVersion !== 1 || value.source !== 'Blender' || !Array.isArray(value.entries)) throw new Error('Invalid image library')
      setGallery(value)
    }).catch(() => { if (!abort.signal.aborted) setError(true) })
    return () => abort.abort()
  }, [])
  const selection = houseIdeaSelection(brief), key = houseIdeaKey(selection)
  const entry = gallery?.entries.find(item => item.id === key)
  const image = entry?.status === 'ready' && entry.image && failedImage !== key ? `${entry.image}?v=${entry.renderDigest?.slice(0, 12) ?? '1'}` : undefined
  const level = selection.storeys === 0 ? 'Ground only' : `G+${selection.storeys}`
  const type = selection.type === 'large-villa' ? 'Large villa' : 'Villa / bungalow'
  return <aside aria-label={t('Basic House Idea Preview')} className="brief-house-preview z-[5] max-h-[calc(100dvh-var(--brief-rail-height)-32px)] overflow-y-auto border border-line bg-bg p-4 text-ink">
    <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
      <div><p className="label">{t('House ideas')}</p><h2 className="mt-1 font-display text-xl">{t('Basic House Idea')}</h2>
        <p className="mt-1 text-xs text-ink-dim">{t(type)} · {t(level)}</p></div>
      <button type="button" onClick={() => setCollapsed(v => !v)} aria-expanded={!collapsed} className="min-h-11 border border-line px-3 text-xs">{t(collapsed ? 'Expand' : 'Collapse')}</button>
    </div>
    {!collapsed && <div className="mt-3 space-y-3">
      <p className="text-sm text-ink-dim">{t(STYLE_LABELS[selection.style] ?? selection.style)} · {t(LAYOUT_LABELS[selection.layout] ?? selection.layout)}{selection.composition !== 'auto' && ` · ${t(modernCompositionTitle(selection.composition as ModernComposition))}`}</p>
      <div className="aspect-[4/3] overflow-hidden border border-line bg-bg-inset" data-house-idea={key}>
        {image ? <img key={key} src={image} alt={t('Blender design example')+` · ${t(STYLE_LABELS[selection.style] ?? selection.style)} · ${t(LAYOUT_LABELS[selection.layout] ?? selection.layout)} · ${t(level)}`} width={768} height={576} decoding="async" onError={() => setFailedImage(key)} className="h-full w-full object-contain" /> : <div role="status" className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-dim">{t(!gallery && !error ? 'Loading design images…' : selection.composition === 'terraced-villa' && selection.storeys === 0 ? 'Terraced villas need an upper floor. Choose G+1 or above for this example.' : 'No Blender image is available for this combination.')}</div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-dim"><span>{t('Blender design example')}</span>{image && <a href={image} download className="inline-flex min-h-11 items-center gap-2 text-ink underline underline-offset-4"><Download size={14} aria-hidden="true" />{t('Download image')}</a>}</div>
    </div>}
  </aside>
}
