import { useEffect, useState } from 'react'
import { Loader2, Lock, X } from 'lucide-react'
import { useAuth } from '@/state/auth.ts'
import { Button } from '@/components/ui/Button.tsx'
import { Field, TextInput } from '@/components/ui/controls.tsx'
import { cx } from '@/lib/cx.ts'

type Mode = 'in' | 'up'

/** Mounted by App only while `useAuth().dialogOpen` — so every open is fresh. */
export function AuthDialog() {
  const close = useAuth((s) => s.closeDialog)
  const signIn = useAuth((s) => s.signIn)
  const signUp = useAuth((s) => s.signUp)

  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmSent, setConfirmSent] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = mode === 'in' ? await signIn(email, password) : await signUp(email, password)
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    if (mode === 'up' && 'needsConfirm' in res && res.needsConfirm) {
      setConfirmSent(true)
      return
    }
    // success → the store closes the dialog
  }

  const canSubmit = /.+@.+\..+/.test(email) && password.length >= 6

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={close}
      role="presentation"
    >
      <div
        className="w-full max-w-sm border border-line bg-bg-raised"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'in' ? 'Sign in' : 'Create account'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="flex items-center gap-2 font-display text-lg">
            <Lock size={15} className="text-accent" />
            {confirmSent ? 'Check your inbox' : mode === 'in' ? 'Sign in' : 'Create account'}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="text-ink-faint hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {confirmSent ? (
          <div className="space-y-4 p-5 text-sm text-ink-dim">
            <p>
              We sent a confirmation link to <span className="text-ink">{email}</span>. Open it, then
              come back and sign in.
            </p>
            <Button variant="ghost" className="w-full" onClick={() => setConfirmSent(false)}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4 p-5"
            onSubmit={(e) => {
              e.preventDefault()
              if (canSubmit) void submit()
            }}
          >
            <Field label="Email">
              <TextInput
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
              />
            </Field>
            <Field label="Password" hint={mode === 'up' ? 'At least 6 characters.' : undefined}>
              <TextInput
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              />
            </Field>

            {error && (
              <p className="border-l-2 border-bad/60 bg-bad/5 px-3 py-2 text-xs text-bad">{error}</p>
            )}

            <Button type="submit" disabled={!canSubmit || busy} className="w-full">
              {busy && <Loader2 size={13} className="animate-spin" />}
              {mode === 'in' ? 'Sign in' : 'Create account'}
            </Button>

            <p className="text-center text-xs text-ink-faint">
              {mode === 'in' ? "No account yet?" : 'Already have an account?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'in' ? 'up' : 'in')
                  setError(null)
                }}
                className={cx('font-mono uppercase tracking-[0.1em] text-ink-dim hover:text-ink')}
              >
                {mode === 'in' ? 'Create one' : 'Sign in'}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
