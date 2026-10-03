import { useMemo, useState } from 'react'
import type { Brief } from '@/lib/model/brief.ts'
import type { CostEstimate } from '@/lib/cost/index.ts'
import { createPublicSheet, type PublicSheet } from '@/lib/cost/publicSheet.ts'

export function CostShareButton({ brief, cost }: { brief: Brief; cost: CostEstimate }) {
  const sheet = useMemo(() => createPublicSheet(brief, cost), [brief, cost])
  const [saved, setSaved] = useState<{ sheet: PublicSheet; url: string } | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const share = async () => {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/cost-shares', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sheet) })
      const data = await response.json()
      if (!response.ok || !/^\/share\/finishes\/[a-f0-9]{64}$/.test(data.path)) throw new Error(data.error || 'The share service is unavailable. Start the backend and try again.')
      setSaved({ sheet, url: new URL(data.path, window.location.origin).href })
    } catch (e) { setError(e instanceof Error ? e.message : 'The sheet could not be shared.') }
    finally { setBusy(false) }
  }
  const current = saved?.sheet === sheet ? saved : null
  return <section className="border border-line p-4"><h3 className="font-display text-lg">Share finishes & estimate</h3><p className="mt-2 text-xs leading-relaxed text-ink-faint">Anyone with the link can view this saved sheet. It has no editing controls; later changes need a new link.</p>
    <button type="button" disabled={busy} onClick={()=>void share()} className="mt-3 w-full border border-line px-4 py-3 text-xs disabled:opacity-50">{busy ? 'Preparing link…' : current ? 'Create another read-only link' : 'Create read-only link'}</button>
    {current && <label className="mt-3 block text-xs">Read-only link<input readOnly aria-label="Read-only specification link" value={current.url} onFocus={e=>e.target.select()} className="mt-2 w-full border border-line bg-bg px-2 py-2 text-xs"/><a href={current.url} target="_blank" rel="noreferrer" className="mt-2 inline-block underline">Open shared sheet</a></label>}
    {error && <p role="alert" className="mt-3 text-xs text-bad">{error}</p>}
  </section>
}
