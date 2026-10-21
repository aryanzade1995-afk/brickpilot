import { useEffect, useRef, useState } from 'react'
import { settingsSchema, type DrawingSettings } from '@/lib/utilities/drawingProject.ts'
import { translate as t } from '@/lib/i18n/index.ts'

export const drawingButton = 'min-h-11 border border-line px-3 py-2 text-xs text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40'
export function DrawingSettingsDialog({ open, settings, onClose, onApply }: { open: boolean; settings: DrawingSettings; onClose: () => void; onApply: (settings: DrawingSettings) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), [draft, setDraft] = useState(settings), [error, setError] = useState('')
  useEffect(() => { if (open) { setDraft(settings); setError(''); dialog.current?.showModal() } else dialog.current?.close() }, [open, settings])
  return <dialog ref={dialog} onCancel={onClose} className="m-auto max-h-[90dvh] w-[min(640px,94vw)] overflow-y-auto border border-line bg-bg p-6 text-ink backdrop:bg-black/40" aria-labelledby="drawing-settings-title">
    <form onSubmit={e => { e.preventDefault(); const result = settingsSchema.safeParse(draft); if (!result.success) { setError('Check the project code and date. Use letters, numbers, dash or underscore in the code.'); return } onApply(result.data); onClose() }}>
      <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">FORMSTEAD</p><h2 id="drawing-settings-title" className="mt-2 font-display text-2xl">{t('Project Settings')}</h2></div><button type="button" className={drawingButton} onClick={onClose}>{t('Close')}</button></div>
      <p className="mt-3 text-xs text-ink-dim">{t('These fields belong to the utility drawing. They do not change your building or BOQ.')}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">{([['projectName', 'Project name'], ['client', 'Client'], ['projectCode', 'Project code'], ['date', 'Drawing date'], ['drawnBy', 'Drawn by'], ['checkedBy', 'Checked by']] as const).map(([key, label]) => <label key={key} className="text-xs text-ink-dim">{t(label)}<input type={key === 'date' ? 'date' : 'text'} className="mt-2 min-h-11 w-full border border-line bg-bg px-3 text-ink" value={draft[key]} maxLength={key === 'projectCode' ? 20 : 180} required={key === 'projectCode' || key === 'date'} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} /></label>)}</div>
      <p className="mt-4 text-xs text-ink-faint">{t('Drawing titles and numbers follow the selected layer and floor. An empty checked-by field means not checked.')}</p>
      {error && <p role="alert" className="mt-3 text-xs text-bad">{t(error)}</p>}
      <div className="mt-6 flex justify-end gap-2"><button type="button" className={drawingButton} onClick={onClose}>{t('Cancel')}</button><button type="submit" className={`${drawingButton} bg-accent text-bg`}>{t('Apply settings')}</button></div>
    </form>
  </dialog>
}
