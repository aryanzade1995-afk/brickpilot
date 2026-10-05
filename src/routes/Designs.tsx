import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Copy, FolderOpen, History, Loader2, Lock, Pencil, PencilRuler, Plus, Trash2, X } from 'lucide-react'
import { CHARACTER_LABEL } from '@/lib/model/brief.ts'
import { useAuth } from '@/state/auth.ts'
import { useDesigns, type SavedDesign } from '@/state/designs.ts'
import { STAGES, stageLabel, useProjects, type Project, type StageId, type Summary } from '@/state/projects.ts'
import { Button } from '@/components/ui/Button.tsx'
import { cx } from '@/lib/cx.ts'

export function Designs() {
  const configured = useAuth((s) => s.configured)
  const authStatus = useAuth((s) => s.status)
  const user = useAuth((s) => s.user)
  const openDialog = useAuth((s) => s.openDialog)
  const projects = useProjects((s) => s.items)
  const storageError = useProjects((s) => s.error)

  const { items, loading, error, fetch } = useDesigns()

  useEffect(() => {
    if (user) fetch()
  }, [user, fetch])

  return (
    <div className="mx-auto max-w-[980px] px-6 py-12 md:px-10">
      <div className="flex flex-wrap items-center gap-3">
        <FolderOpen size={20} className="text-accent" />
        <h1 className="font-display text-[clamp(1.8rem,3.5vw,2.6rem)]">My designs</h1>
        <Link to="/start" className="ml-auto flex items-center gap-1.5 border border-line-strong px-3 py-2 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-dim hover:border-ink-dim hover:text-ink">
          <Plus size={13} /> New design
        </Link>
      </div>
      <p className="mt-3 max-w-xl text-ink-dim">
        Every villa you save keeps its plot, its 2D plan with every room and lock, its 3D design and its construction stage.
        Open one to carry on exactly where you stopped.
      </p>
      {storageError && <p role="alert" className="mt-4 border border-bad/50 px-4 py-3 text-sm text-bad">{storageError}</p>}

      <section className="mt-8" aria-label="Saved on this device">
        <h2 className="label mb-3">On this device · {projects.length}</h2>
        {projects.length === 0 ? (
          <Empty>
            <p>No saved designs yet.</p>
            <p className="mt-1 text-sm text-ink-faint">
              Choose a direction in the studio and it saves itself, or press <span className="text-ink">Save design</span> in the header.
            </p>
          </Empty>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {projects.map((p) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </ul>
        )}
      </section>

      {configured && (
        <section className="mt-12" aria-label="Saved in your account">
          <h2 className="label mb-3">In your account{user ? ` · ${items.length}` : ''}</h2>
          {authStatus === 'loading' ? (
            <Empty>
              <Loader2 size={14} className="inline animate-spin" /> Checking your session…
            </Empty>
          ) : !user ? (
            <Empty>
              <p>Sign in to keep a copy of your designs in your account.</p>
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
              <p>Nothing saved to your account yet. Saving while signed in adds a copy here.</p>
            </Empty>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {items.map((d) => (
                <DesignRow key={d.id} design={d} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

const TYPE_FILL: Record<string, string> = {
  bedroom: '#bb997b', living: '#789daf', dining: '#789daf', kitchen: '#82968d', washroom: '#82968d', store: '#9aa89f', puja: '#bcac79', study: '#9b8cb3',
  open: '#cfd8c4', vacant: '#e7dcc4', fixed: '#b7bfc7', social: '#789daf', private: '#bb997b', service: '#82968d', circulation: '#b7bfc7', work: '#9b8cb3', sacred: '#bcac79',
}

/** the ground floor of a saved design, drawn from the room positions saved with it */
function Thumb({ summary }: { summary: Summary }) {
  const floor = summary.floors[0]
  if (!floor || !floor.rooms.length) return null
  const x0 = Math.min(...floor.rooms.map((r) => r.x)), y0 = Math.min(...floor.rooms.map((r) => r.y))
  const x1 = Math.max(...floor.rooms.map((r) => r.x + r.w)), y1 = Math.max(...floor.rooms.map((r) => r.y + r.h))
  const pad = 600
  return (
    <svg viewBox={`${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`} className="h-full w-full" role="img" aria-label="Ground floor plan">
      {floor.rooms.map((r) => (
        <rect key={r.id} x={r.x} y={r.y} width={r.w} height={r.h} fill={TYPE_FILL[r.type] ?? '#ccc'} stroke="#2b2b2b" strokeWidth={90} />
      ))}
      {floor.rooms.filter((r) => r.locked).map((r) => (
        <rect key={`l${r.id}`} x={r.x + 150} y={r.y + 150} width={Math.min(900, r.w / 3)} height={Math.min(900, r.h / 3)} fill="#B45309" />
      ))}
    </svg>
  )
}

function ProjectRow({ project }: { project: Project }) {
  const open = useProjects((s) => s.open)
  const rename = useProjects((s) => s.rename)
  const duplicate = useProjects((s) => s.duplicate)
  const remove = useProjects((s) => s.remove)
  const restore = useProjects((s) => s.restore)
  const currentId = useProjects((s) => s.currentId)
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(project.name)
  const [confirmDel, setConfirmDel] = useState(false)
  const [showVersions, setShowVersions] = useState(false)

  const s = project.summary
  const meta = [s ? `${s.plot.widthM} × ${s.plot.depthM} m` : null, s ? `G+${s.storeys}` : null, s ? `${Math.round(s.builtAreaSqm)} m² built` : null].filter(Boolean).join(' · ')
  const lockedCount = s?.locked.length ?? 0
  const go = (edit: boolean) => {
    if (!open(project.id)) return
    navigate(project.core.pinned || project.core.existing ? `/workspace/plan${edit ? '?edit=1' : ''}` : '/workspace/directions')
  }
  const commitName = () => {
    rename(project.id, name)
    setEditing(false)
  }

  return (
    <li className="py-5" data-project={project.id}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="h-20 w-28 flex-none border border-line bg-bg-inset p-1" aria-hidden={!s}>
          {s ? <Thumb summary={s} /> : null}
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={name}
                autoFocus
                aria-label="Project name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName()
                  else if (e.key === 'Escape') {
                    setName(project.name)
                    setEditing(false)
                  }
                }}
                className="w-full max-w-xs border border-line-strong bg-bg-inset px-2 py-1 text-sm text-ink outline-none focus:border-accent"
              />
              <button type="button" aria-label="Save name" onClick={commitName} className="text-ok hover:opacity-80">
                <Check size={15} />
              </button>
              <button type="button" aria-label="Cancel" onClick={() => { setName(project.name); setEditing(false) }} className="text-ink-faint hover:text-ink">
                <X size={15} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="truncate font-display text-lg">{project.name}</span>
              <button type="button" aria-label="Rename" onClick={() => setEditing(true)} className="flex-none text-ink-faint hover:text-ink">
                <Pencil size={12} />
              </button>
              {currentId === project.id && <span className="flex-none border border-accent/60 px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-accent">Open now</span>}
              {project.draft && <span className="flex-none border border-line-strong px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-faint">Auto-saved</span>}
            </div>
          )}
          <p className="mt-0.5 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-ink-faint">
            {meta}{meta ? ' · ' : ''}{new Date(project.updatedAt).toLocaleDateString()}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-dim">
            <span className="border border-line px-1.5 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.06em]">{stageLabel(project.core.stage)}</span>
            {s?.edited && <span className="flex items-center gap-1"><PencilRuler size={11} /> Edited plan</span>}
            {lockedCount > 0 && <span className="flex items-center gap-1"><Lock size={11} /> {lockedCount} locked</span>}
            {s?.design && <span>{s.design.massing.replaceAll('-', ' ')}</span>}
          </p>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-2">
          {confirmDel ? (
            <>
              <button type="button" onClick={() => remove(project.id)} className="border border-bad/60 px-2.5 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-bad">
                Delete for good
              </button>
              <button type="button" onClick={() => setConfirmDel(false)} className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-faint hover:text-ink">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => go(true)} className="flex items-center gap-1.5 border border-accent/70 px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-accent hover:bg-accent/10">
                <PencilRuler size={12} /> Continue editing
              </button>
              <button type="button" onClick={() => go(false)} className="flex items-center gap-1.5 border border-line-strong px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-dim hover:border-ink-dim hover:text-ink">
                <FolderOpen size={12} /> Open
              </button>
              <button type="button" aria-label="Duplicate" title="Duplicate" onClick={() => duplicate(project.id)} className="text-ink-faint hover:text-ink">
                <Copy size={14} />
              </button>
              <button type="button" aria-label="Version history" title="Version history" aria-expanded={showVersions} onClick={() => setShowVersions((v) => !v)} className={cx('text-ink-faint hover:text-ink', showVersions && 'text-accent')}>
                <History size={14} />
              </button>
              <button type="button" aria-label="Delete" title="Delete" onClick={() => setConfirmDel(true)} className="text-ink-faint hover:text-bad">
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
      {showVersions && (
        <div className="mt-3 border border-line p-3" aria-label="Version history">
          <div className="mb-2 flex items-center gap-3">
            <p className="label">Version history · {project.versions.length}</p>
            <label className="ml-auto flex items-center gap-2 text-xs text-ink-dim">
              Stage
              <select aria-label="Construction stage" value={project.core.stage} onChange={(e) => useProjects.getState().setStage(e.target.value as StageId, project.id)} className="border border-line-strong bg-bg-inset px-2 py-1 text-ink">
                {STAGES.map((st) => (
                  <option key={st.id} value={st.id}>{st.label}</option>
                ))}
              </select>
            </label>
          </div>
          <ul className="divide-y divide-line">
            {project.versions.map((v, i) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0">
                  <span className="truncate text-ink">{v.label}</span> <span className="text-xs text-ink-faint">{new Date(v.at).toLocaleString()}</span>
                </span>
                {i === 0 ? (
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-faint">Latest</span>
                ) : (
                  <button type="button" onClick={() => { restore(project.id, v.id); go(false) }} className="border border-line-strong px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-dim hover:text-ink">
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}

/* The designs kept in the signed-in account (the original saved-designs list). */
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
            <button type="button" aria-label="Save name" onClick={() => { rename(design.id, name); setEditing(false) }} className="text-ok hover:opacity-80">
              <Check size={15} />
            </button>
            <button type="button" aria-label="Cancel" onClick={() => { setName(design.name); setEditing(false) }} className="text-ink-faint hover:text-ink">
              <X size={15} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-lg">{design.name}</span>
            <button type="button" aria-label="Rename" onClick={() => setEditing(true)} className="flex-none text-ink-faint hover:text-ink">
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
            <button type="button" onClick={() => remove(design.id)} className="border border-bad/60 px-2.5 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-bad">
              Delete
            </button>
            <button type="button" onClick={() => setConfirmDel(false)} className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-faint hover:text-ink">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={open} className="flex items-center gap-1.5 border border-line-strong px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-dim hover:border-ink-dim hover:text-ink">
              <FolderOpen size={12} /> Load
            </button>
            <button type="button" aria-label="Delete" onClick={() => setConfirmDel(true)} className="text-ink-faint hover:text-bad">
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
