import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { NavLink } from 'react-router-dom'
import { cx } from '@/lib/cx.ts'
import { preloadWorkspacePage } from '@/lib/workspacePages.ts'

const TABS = [
  { to: '/workspace', label: 'Brief', n: '01' },
  { to: '/workspace/directions', label: 'Directions', n: '02' },
  { to: '/workspace/plan', label: '2D plan', n: '03' },
  { to: '/workspace/massing', label: '3D massing', n: '04' },
  { to: '/workspace/finishes', label: 'Finishes & Cost', n: '05' },
  { to: '/workspace/interior', label: 'AI Interior', n: '06' },
  { to: '/workspace/report', label: 'Report', n: '07' },
  { to: '/workspace/dataset', label: 'Villa references', n: '' },
]

export function WorkspaceTabs() {
  useLanguage(s => s.language);

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line pb-px">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          onPointerEnter={() => preloadWorkspacePage(t.to)}
          onFocus={() => preloadWorkspacePage(t.to)}
          onTouchStart={() => preloadWorkspacePage(t.to)}
          end={t.to === '/workspace'}
          className={({ isActive, isPending }) =>
            cx(
              'flex flex-none items-center gap-2 border-b-2 px-3 py-2.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] transition-colors',
              isActive || isPending
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-faint hover:text-ink-dim',
            )
          }
        >
          {({ isPending }) => <><span className={isPending ? 'animate-pulse' : undefined}>{translateUi(t.n)}</span>{translateUi(t.label)}</>}
        </NavLink>
      ))}
    </div>
  )
}
