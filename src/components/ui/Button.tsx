import { Link } from 'react-router-dom'
import type { ComponentProps, ReactNode } from 'react'
import { cx } from '@/lib/cx.ts'

type Variant = 'primary' | 'ghost' | 'quiet'
type Size = 'sm' | 'md'

const base =
  'inline-flex items-center justify-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.12em] ' +
  'transition-colors duration-150 select-none disabled:opacity-40 disabled:pointer-events-none'

const sizes: Record<Size, string> = {
  sm: 'px-3 py-2',
  md: 'px-5 py-3',
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hot',
  ghost: 'border border-line-strong text-ink hover:border-ink-dim hover:bg-bg-raised',
  quiet: 'text-ink-dim hover:text-ink',
}

type CommonProps = {
  variant?: Variant
  size?: Size
  children: ReactNode
  className?: string
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: CommonProps & ComponentProps<'button'>) {
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} {...rest}>
      {children}
    </button>
  )
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  children,
  to,
  ...rest
}: CommonProps & { to: string } & Omit<ComponentProps<typeof Link>, 'to'>) {
  return (
    <Link to={to} className={cx(base, sizes[size], variants[variant], className)} {...rest}>
      {children}
    </Link>
  )
}
