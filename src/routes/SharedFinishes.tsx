import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { publicSheetSchema } from '@/lib/cost/deliverySchemas.ts'
import type { PublicSheet } from '@/lib/cost/publicSheet.ts'
import { SpecificationSchedule } from '@/components/SpecificationSchedule.tsx'
import { formatINR, formatRange } from '@/lib/format.ts'

export function SharedFinishes() {
  const { token } = useParams(), [sheet, setSheet] = useState<PublicSheet | null>(null), [error, setError] = useState(''), [exporting, setExporting] = useState(false)
  useEffect(() => {
    const abort = new AbortController()
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return
    fetch(`/api/cost-shares/${token}`, { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('This shared sheet is no longer available.')
      return publicSheetSchema.parse(await response.json())
    }).then(setSheet).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'The shared sheet could not load.') })
    return () => abort.abort()
  }, [token])
  const download = async () => {
    if (!sheet) return
    setExporting(true)
    try { const { buildSpecSheetPdf } = await import('@/lib/report/specSheet.ts'); const blob = await buildSpecSheetPdf(sheet); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href=url; link.download='formstead-shared-specifications.pdf'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),4000) }
    catch { setError('The specification PDF could not be prepared. Please try again.') }
    finally { setExporting(false) }
  }
  if (!sheet) return <main className="mx-auto max-w-5xl px-5 py-12"><h1 className="font-display text-2xl">Shared finishes & estimate</h1><p className="mt-4 text-sm text-ink-dim">{error || (!token || !/^[a-f0-9]{64}$/.test(token) ? 'This link is incomplete.' : 'Loading the read-only sheet…')}</p></main>
  return <main className="mx-auto max-w-5xl px-5 py-10 md:px-10"><p className="label">Formstead · Read-only sheet</p><h1 className="mt-3 font-display text-3xl">{sheet.projectName}</h1><p className="mt-3 text-xs text-ink-faint">Saved {new Date(sheet.createdAt).toLocaleDateString()} · {sheet.cost.label}</p>
    <button type="button" disabled={exporting} onClick={()=>void download()} className="my-5 border border-line px-4 py-3 text-xs">{exporting ? 'Preparing PDF…' : 'Download spec sheet PDF'}</button>
    {error && <p role="alert" className="mb-4 text-xs text-bad">{error}</p>}
    <SpecificationSchedule rows={sheet.schedule}/>
    <section className="mt-9 border-t border-line pt-5"><h2 className="font-display text-2xl">Concept estimate</h2><p className="mt-3 font-display text-3xl">{formatINR(sheet.cost.expected)}</p><p className="mt-2 text-sm">Range {formatRange(sheet.cost.total.low,sheet.cost.total.high,formatINR)} · {formatINR(sheet.cost.ratePerSqft)} / sq ft</p><p className="mt-3 text-xs leading-relaxed text-ink-dim">{sheet.cost.qualification}</p><dl className="mt-5 divide-y divide-line">{sheet.cost.tradeTotals.map(t=><div key={t.trade} className="py-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><dt>{t.trade}</dt><dd>{formatINR(t.amount)} · {(t.share*100).toFixed(1)}%</dd></div><div className="mt-2 h-1.5 bg-bg-inset"><div className="h-full bg-ink-dim" style={{width:`${t.share*100}%`}}/></div></div>)}</dl><p className="mt-3 text-xs text-ink-faint">Trade amounts are works before project add-ons. The expected total includes fees, overhead, contingency, tax provision and allowances from the saved estimate.</p></section>
    <section className="mt-8 grid gap-6 md:grid-cols-2">{([['Included',sheet.cost.included],['Excluded',sheet.cost.excluded],['Assumptions',sheet.cost.assumptions],['Sources',sheet.cost.sources]] as const).map(([title,values])=><div key={title}><h2 className="font-display text-xl">{title}</h2><ul className="mt-3 space-y-2 text-xs leading-relaxed text-ink-dim [overflow-wrap:anywhere]">{values.map(v=><li key={v}>{v}</li>)}</ul></div>)}</section>
    <p className="mt-8 border-t border-line pt-5 text-xs text-ink-faint">Approximate concept only; no structural certification. Actual products, structural design, site conditions and contractor quotes determine final cost.</p>
  </main>
}
