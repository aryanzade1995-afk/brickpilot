import { NavLink } from 'react-router-dom'
import { cx } from '@/lib/cx.ts'

const TABS = [
  { to: '/workspace', label: 'Brief', n: '01' },
  { to: '/workspace/directions', label: 'Directions', n: '02' },
  { to: '/workspace/plan', label: '2D plan', n: '03' },
  { to: '/workspace/massing', label: '3D massing', n: '04' },
  { to: '/workspace/render', label: 'Render', n: '05' },
  { to: '/workspace/report', label: 'Report', n: '06' },
]

export function WorkspaceTabs() {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line pb-px">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/workspace'}
          className={({ isActive }) =>
            cx(
              'flex flex-none items-center gap-2 border-b-2 px-3 py-2.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] transition-colors',
              isActive
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-faint hover:text-ink-dim',
            )
          }
        >
          <span>{t.n}</span>
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}
