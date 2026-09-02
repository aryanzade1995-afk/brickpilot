import { useState } from 'react'
import { Check, Loader2, Save } from 'lucide-react'
import { useAuth } from '@/state/auth.ts'
import { useDesigns } from '@/state/designs.ts'
import { cx } from '@/lib/cx.ts'

/** Workspace-header "Save" — upserts the current brief + pinned direction to the
 *  signed-in user's account. Logged-out, it opens the sign-in dialog instead. */
export function SaveDesignButton() {
  const user = useAuth((s) => s.user)
  const openDialog = useAuth((s) => s.openDialog)
  const saveCurrent = useDesigns((s) => s.saveCurrent)
  const currentId = useDesigns((s) => s.currentId)

  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState<string | null>(null)

  const onClick = async () => {
    if (!user) return openDialog()
    if (state === 'saving') return
    setState('saving')
    setMsg(null)
    const res = await saveCurrent()
    if (res.error) {
      setState('error')
      setMsg(res.error)
      return
    }
    setState('saved')
    setTimeout(() => setState('idle'), 1800)
  }

  const label =
    state === 'saving'
      ? 'Saving…'
      : state === 'saved'
        ? 'Saved'
        : state === 'error'
          ? 'Retry save'
          : currentId
            ? 'Save'
            : 'Save design'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        title={msg ?? undefined}
        className={cx(
          'flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.12em] transition-colors',
          state === 'error'
            ? 'border-bad/60 text-bad'
            : state === 'saved'
              ? 'border-ok/60 text-ok'
              : 'border-line-strong text-ink-dim hover:border-ink-dim hover:text-ink',
        )}
      >
        {state === 'saving' ? (
          <Loader2 size={12} className="animate-spin" />
        ) : state === 'saved' ? (
          <Check size={12} />
        ) : (
          <Save size={12} />
        )}
        {label}
      </button>
    </div>
  )
}
