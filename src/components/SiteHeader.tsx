import { Link, NavLink } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { ButtonLink } from './ui/Button.tsx'
import { cx } from '@/lib/cx.ts'

const NAV = [
  { label: 'Studio', to: '/workspace' },
  { label: 'Drawing set', to: '/workspace' },
  { label: 'Evidence', to: '/workspace' },
  { label: 'How it works', to: '/' },
]

export function SiteHeader({ variant }: { variant: 'marketing' | 'workspace' }) {
  return (
    <header className="relative z-20 border-b border-line">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-8 px-6 md:px-10">
        <Link to="/" className="flex items-baseline gap-3">
          <span className="font-display text-2xl leading-none text-accent">BrickPilot</span>
          {variant === 'workspace' && (
            <span className="label hidden md:inline">Residential Concept Engineering</span>
          )}
        </Link>

        {variant === 'marketing' && (
          <nav className="hidden flex-1 items-center justify-center gap-9 lg:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.14em] text-ink-dim transition-colors hover:text-ink"
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}

        {variant === 'workspace' && (
          <div className="hidden flex-1 items-center gap-3 lg:flex">
            <span className="text-line-strong">|</span>
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-faint">
              Topology &middot; Validation &middot; Cost &middot; Drawing
            </span>
          </div>
        )}

        <div className={cx('flex items-center gap-4', variant === 'marketing' && 'ml-auto')}>
          {variant === 'marketing' ? (
            <>
              <Link
                to="/workspace"
                className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.14em] text-ink-dim transition-colors hover:text-ink"
              >
                Sign in
              </Link>
              <ButtonLink to="/workspace" size="sm">
                Get started
                <ArrowUpRight size={13} strokeWidth={2.5} />
              </ButtonLink>
            </>
          ) : (
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-faint">
              Local draft
            </span>
          )}
        </div>
      </div>
    </header>
  )
}
