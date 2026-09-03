import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, FolderOpen, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { CHARACTER_LABEL } from '@/lib/model/brief.ts'
import { useAuth } from '@/state/auth.ts'
import { useDesigns, type SavedDesign } from '@/state/designs.ts'
import { Button } from '@/components/ui/Button.tsx'
import { cx } from '@/lib/cx.ts'

export function Designs() {
  const configured = useAuth((s) => s.configured)
  const authStatus = useAuth((s) => s.status)
  const user = useAuth((s) => s.user)
  const openDialog = useAuth((s) => s.openDialog)

  const { items, loading, error, fetch } = useDesigns()

  useEffect(() => {
    if (user) fetch()
  }, [user, fetch])

  return (
    <div className="mx-auto max-w-[900px] px-6 py-12 md:px-10">
      <div className="flex items-center gap-3">
        <FolderOpen size={20} className="text-accent" />
        <h1 className="font-display text-[clamp(1.8rem,3.5vw,2.6rem)]">My designs</h1>
      </div>
      <p className="mt-3 max-w-xl text-ink-dim">
        Every saved project is its brief plus the pinned direction — loading one rebuilds the plan,
        validation and costs exactly.
      </p>

      <div className="mt-8">
        {!configured ? (
          <Empty>Accounts are not configured for this deployment.</Empty>
        ) : authStatus === 'loading' ? (
          <Empty>
            <Loader2 size={14} className="inline animate-spin" /> Checking your session…
          </Empty>
        ) : !user ? (
          <Empty>
            <p>Sign in to see the designs saved to your account.</p>
            <Button className="mt-4" onClick={openDialog}>
              Sign in
            </Button>
          </Empty>
        ) : loading ? (
          <Empty>
            <Loader2 size={14} className="inline animate-spin" /> Loading your designs…
          </Empty>
        ) : error ? (
          <Empty>
            <p className="text-bad">{error}</p>
            <Button variant="ghost" className="mt-4" onClick={fetch}>
              Try again
            </Button>
          </Empty>
        ) : items.length === 0 ? (
          <Empty>
            <p>No saved designs yet.</p>
            <p className="mt-1 text-sm text-ink-faint">
              Build a brief, then hit <span className="text-ink">Save design</span> in the header.
            </p>
          </Empty>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {items.map((d) => (
              <DesignRow key={d.id} design={d} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function DesignRow({ design }: { design: SavedDesign }) {
  const load = useDesigns((s) => s.load)
  const rename = useDesigns((s) => s.rename)
  const remove = useDesigns((s) => s.remove)
  const navigate = useNavigate()

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(design.name)
  const [confirmDel, setConfirmDel] = useState(false)

  const b = design.brief
  const beds = b.rooms.bedroomsWithBath + b.rooms.bedroomsNoBath
  const meta = [
    b.project.buildingType === 'large-villa' ? 'Large villa' : CHARACTER_LABEL[b.style.character],
    b.project.buildingType === 'large-villa' ? CHARACTER_LABEL[b.style.character] : null,
    `${b.site.plotWidth} × ${b.site.plotDepth} m`,
    `G+${b.levels.storeys}`,
    `${beds} bed${beds === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ')

  const open = () => {
    const d = load(design.id)
    if (d) navigate(d.pinned ? '/workspace/plan' : '/workspace/directions')
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  rename(design.id, name)
                  setEditing(false)
                } else if (e.key === 'Escape') {
                  setName(design.name)
                  setEditing(false)
                }
              }}
              className="w-full max-w-xs border border-line-strong bg-bg-inset px-2 py-1 text-sm text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              aria-label="Save name"
              onClick={() => {
                rename(design.id, name)
                setEditing(false)
              }}
              className="text-ok hover:opacity-80"
            >
              <Check size={15} />
            </button>
            <button
              type="button"
              aria-label="Cancel"
              onClick={() => {
                setName(design.name)
                setEditing(false)
              }}
              className="text-ink-faint hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-lg">{design.name}</span>
            <button
              type="button"
              aria-label="Rename"
              onClick={() => setEditing(true)}
              className="flex-none text-ink-faint hover:text-ink"
            >
              <Pencil size={12} />
            </button>
          </div>
        )}
        <p className="mt-0.5 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-ink-faint">
          {meta} · {new Date(design.updatedAt).toLocaleDateString()}
        </p>
      </div>

      <div className="flex flex-none items-center gap-2">
        {confirmDel ? (
          <>
            <button
              type="button"
              onClick={() => remove(design.id)}
              className="border border-bad/60 px-2.5 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-bad"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDel(false)}
              className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-faint hover:text-ink"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={open}
              className="flex items-center gap-1.5 border border-line-strong px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-dim hover:border-ink-dim hover:text-ink"
            >
              <FolderOpen size={12} /> Load
            </button>
            <button
              type="button"
              aria-label="Delete"
              onClick={() => setConfirmDel(true)}
              className={cx('text-ink-faint hover:text-bad')}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </li>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="border border-line px-6 py-16 text-center text-ink-dim">
      <div className="mx-auto max-w-sm">{children}</div>
    </div>
  )
}
