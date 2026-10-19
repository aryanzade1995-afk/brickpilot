import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { Link, NavLink } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { ButtonLink } from './ui/Button.tsx'
import { AccountMenu } from './AccountMenu.tsx'
import { SaveDesignButton } from './SaveDesignButton.tsx'
import { LanguageSelector } from './LanguageSelector.tsx'
import { useAuth } from '@/state/auth.ts'


const NAV = [
  { label: 'Studio', to: '/workspace' },
  { label: 'Drawing set', to: '/workspace' },
  { label: 'Evidence', to: '/workspace' },
  { label: 'My designs', to: '/designs' },
  { label: 'How it works', to: '/' },
]

function SignInButton({ label }: { label: string }) {
  useLanguage(s => s.language);

  const configured = useAuth((s) => s.configured)
  const status = useAuth((s) => s.status)
  const openDialog = useAuth((s) => s.openDialog)

  if (!configured) {
    return (
      <span
        title={translateUi("Accounts are not configured for this deployment")}
        className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-faint"
      >
        {translateUi(label)} {translateUi(" · off")}</span>
    )
  }
  return (
    <button
      type="button"
      onClick={openDialog}
      disabled={status === 'loading'}
      className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.14em] text-ink-dim transition-colors hover:text-ink disabled:opacity-40"
    >
      {translateUi(label)}
    </button>
  )
}

export function SiteHeader({ variant }: { variant: 'marketing' | 'workspace' }) {
  useLanguage(s => s.language);

  const user = useAuth((s) => s.user)
  const configured = useAuth((s) => s.configured)

  return (
    <header className="relative z-20 border-b border-line">
      <div className="mx-auto flex min-h-16 max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2 md:px-10">
        <Link to="/" className="flex items-baseline gap-3">
          <span className="font-display text-2xl leading-none text-accent">{translateUi("Formstead")}</span>
          {variant === 'workspace' && (
            <span className="label hidden md:inline">{translateUi("Residential Concept Engineering")}</span>
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
                {translateUi(item.label)}
              </NavLink>
            ))}
          </nav>
        )}

        {variant === 'workspace' && (
          <div className="hidden flex-1 items-center gap-3 lg:flex">
            <span className="text-line-strong">|</span>
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-faint">
              {translateUi("Topology · Validation · Cost · Drawing")}</span>
          </div>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <LanguageSelector />
          {variant === 'marketing' ? (
            user ? (
              <>
                <AccountMenu />
                <ButtonLink to="/workspace" size="sm">
                  {translateUi("Open studio")}<ArrowUpRight size={13} strokeWidth={2.5} />
                </ButtonLink>
              </>
            ) : (
              <>
                <SignInButton label="Sign in" />
                <ButtonLink to="/start" size="sm">
                  {translateUi("Get started")}<ArrowUpRight size={13} strokeWidth={2.5} />
                </ButtonLink>
              </>
            )
          ) : (
            <>
              <Link to="/designs" className="hidden font-mono text-[0.7rem] font-medium uppercase tracking-[0.14em] text-ink-dim transition-colors hover:text-ink sm:inline">{translateUi("My designs")}</Link>
              <SaveDesignButton />
              {user ? <AccountMenu /> : configured && <SignInButton label="Sign in" />}
            </>
          )}
        </div>
      </div>
    </header>
  )
}
