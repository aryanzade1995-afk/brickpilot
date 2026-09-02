import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, FolderOpen, LogOut } from 'lucide-react'
import { useAuth } from '@/state/auth.ts'
import { cx } from '@/lib/cx.ts'

export function AccountMenu() {
  const user = useAuth((s) => s.user)
  const signOut = useAuth((s) => s.signOut)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDoc)
    return () => window.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!user) return null
  const label = user.email ?? 'Account'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink-dim transition-colors hover:text-ink"
      >
        <span className="hidden max-w-[14ch] truncate sm:inline">{label}</span>
        <span className="sm:hidden">Account</span>
        <ChevronDown size={13} className={cx('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-52 border border-line bg-bg-raised py-1 shadow-xl">
          <div className="truncate border-b border-line px-3 py-2 text-xs text-ink-faint">{label}</div>
          <Link
            to="/designs"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-ink-dim hover:bg-bg-raised-2 hover:text-ink"
          >
            <FolderOpen size={14} /> My designs
          </Link>
          <button
            type="button"
            onClick={async () => {
              setOpen(false)
              await signOut()
              navigate('/')
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-dim hover:bg-bg-raised-2 hover:text-ink"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
