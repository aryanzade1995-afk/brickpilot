import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, FolderOpen, History, Loader2, Save } from 'lucide-react'
import { useAuth } from '@/state/auth.ts'
import { useDesigns } from '@/state/designs.ts'
import { STAGES, useProjects, type StageId } from '@/state/projects.ts'
import { useStudio } from '@/state/studio.ts'
import { cx } from '@/lib/cx.ts'

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')
const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Workspace-header "Save": keeps the villa as a project on this device (plot, plan, 3D design, rooms, style, stage and locks),
 *  and also to the account when signed in. It saves automatically after every major change; this is the explicit save. */
export function SaveDesignButton() {
  const user = useAuth((s) => s.user)
  const saveCloud = useDesigns((s) => s.saveCurrent)
  const hasDesign = useStudio((s) => !!s.result)
  const projectName = useStudio((s) => s.brief.project.name)
  const { items, currentId, stage, lastSavedAt, error } = useProjects()
  const act = useProjects.getState()
  const current = items.find((p) => p.id === currentId) ?? null

  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const name = draft ?? current?.name ?? projectName ?? ''
  const setName = (v: string) => setDraft(v)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', onDoc)
    return () => window.removeEventListener('mousedown', onDoc)
  }, [open])

  const save = async (nameOverride?: string) => {
    if (!hasDesign || state === 'saving') return
    setState('saving'); setMsg(null)
    const saved = act.save({ name: nameOverride ?? (name.trim() || undefined) })
    if (!saved) { setState('error'); setMsg('Choose a direction first. There is nothing to save yet.'); return }
    // the account copy is best effort: the device copy is already safe
    if (user) { const res = await saveCloud(saved.name); if (res.error) setMsg(`Saved on this device. The account copy failed: ${res.error}`) }
    setDraft(null)
    setState('saved')
    setTimeout(() => setState('idle'), 1800)
  }

  const label = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Retry save' : current && !current.draft ? 'Save' : 'Save design'
  const sub = error ?? msg ?? (lastSavedAt ? `Saved ${clock(lastSavedAt)}` : null)

  return (
    <div ref={ref} className="relative flex items-stretch">
      <button type="button" onClick={() => save()} disabled={!hasDesign} title={!hasDesign ? 'Choose a direction first' : (sub ?? 'Save this design on this device')}
        className={cx('flex items-center gap-1.5 border border-r-0 px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
          state === 'error' ? 'border-bad/60 text-bad' : state === 'saved' ? 'border-ok/60 text-ok' : 'border-line-strong text-ink-dim hover:border-ink-dim hover:text-ink')}>
        {state === 'saving' ? <Loader2 size={12} className="animate-spin" /> : state === 'saved' ? <Check size={12} /> : <Save size={12} />}
        {label}
      </button>
      <button type="button" aria-label="Project options" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={cx('flex items-center border px-1.5 text-ink-dim hover:text-ink', state === 'saved' ? 'border-ok/60' : 'border-line-strong')}>
        <ChevronDown size={13} className={cx('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="dialog" aria-label="Project" className="absolute right-0 top-full z-30 mt-2 w-80 border border-line bg-bg-raised p-4 text-sm shadow-xl">
          <label className="block text-xs text-ink-dim">Project name
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(name) }} onBlur={() => { if (current && name.trim() && name.trim() !== current.name) act.rename(current.id, name); setDraft(null) }}
              placeholder="Untitled villa" className="mt-1 w-full border border-line-strong bg-bg-inset px-2 py-1.5 text-ink outline-none focus:border-accent" />
          </label>
          <label className="mt-3 block text-xs text-ink-dim">Construction stage
            <select aria-label="Construction stage" value={stage} onChange={(e) => act.setStage(e.target.value as StageId)} className="mt-1 w-full border border-line-strong bg-bg-inset px-2 py-1.5 text-ink">
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label} — {s.hint}</option>)}
            </select>
          </label>
          <p className="mt-3 text-xs text-ink-faint" role="status">
            {error ? <span className="text-bad">{error}</span> : lastSavedAt ? `Saved on this device at ${clock(lastSavedAt)}. Changes save automatically.` : 'Not saved yet. Changes save automatically once you choose a direction.'}
          </p>
          {current && current.versions.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="label mb-1.5 flex items-center gap-1.5"><History size={11} /> Version history</p>
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {current.versions.slice(0, 8).map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0"><span className="block truncate text-ink">{v.label}</span><span className="text-ink-faint">{when(v.at)}</span></span>
                    <button type="button" className="flex-none border border-line-strong px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-dim hover:text-ink" onClick={() => { act.restore(current.id, v.id); setOpen(false) }}>Restore</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link to="/designs" onClick={() => setOpen(false)} className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-xs text-ink-dim hover:text-ink"><FolderOpen size={12} /> My designs</Link>
        </div>
      )}
    </div>
  )
}
