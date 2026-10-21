import { useEffect, useMemo, useRef, useState } from 'react'
import type { UtilityFloor } from '@/lib/utilities/plan.ts'
import { detectClashes, createClashCache, applyClashReview, parseClashReviews, reviewClash, type Clash, type ClashReviews, type ClashStatus } from '@/lib/utilities/clashes.ts'

export function useUtilityClashes(model: UtilityFloor, scope: string, initialRecords?: ClashReviews) {
  const cache = useRef(createClashCache())
  const [detection, setDetection] = useState<{ model: UtilityFloor; clashes: Clash[] } | null>(null)
  const [saved, setSaved] = useState<{ scope: string; records: ClashReviews }>({ scope: '', records: {} })
  const [error, setError] = useState(''), [past, setPast] = useState<ClashReviews[]>([]), [future, setFuture] = useState<ClashReviews[]>([])
  const key = `formstead.utility-clash-reviews.v1:${scope}`
  useEffect(() => {
    setPast([]); setFuture([]); setError('')
    try { const stored = localStorage.getItem(key); setSaved({ scope, records: stored ? parseClashReviews(JSON.parse(stored)) : initialRecords ?? {} }) }
    catch { setSaved({ scope, records: {} }); setError('Saved problem reviews could not be read. Your plan is unchanged.') }
  }, [scope, key, initialRecords])
  useEffect(() => {
    const timer = setTimeout(() => setDetection({ model, clashes: detectClashes(model, { cache: cache.current }) }), 200)
    return () => clearTimeout(timer)
  }, [model])
  const records = saved.scope === scope ? saved.records : {}
  const checking = detection?.model !== model
  const clashes = useMemo(() => checking ? [] : detection!.clashes.map(c => applyClashReview(c, records)), [checking, detection, records])
  const persist = (records: ClashReviews) => {
    setSaved({ scope, records })
    try { localStorage.setItem(key, JSON.stringify({ version: 1, records })); setError('') }
    catch { setError('Problem reviews could not be saved on this device. Download a report to keep a copy.') }
  }
  const update = (clash: Clash, status: ClashStatus, note: string) => {
    try {
      const review = reviewClash(clash, status, note)
      setPast(p => [...p.slice(-49), records]); setFuture([])
      persist({ ...records, [clash.id]: review }); return true
    } catch (e) { setError((e as Error).message); return false }
  }
  const undo = () => { const previous = past.at(-1); if (!previous) return; setFuture(f => [...f, records]); setPast(p => p.slice(0, -1)); persist(previous) }
  const redo = () => { const next = future.at(-1); if (!next) return; setPast(p => [...p, records]); setFuture(f => f.slice(0, -1)); persist(next) }
  return { clashes, records, checking, error, update, undo, redo, canUndo: !!past.length, canRedo: !!future.length }
}
