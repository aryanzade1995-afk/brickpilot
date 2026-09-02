import type { KeyboardEvent, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cx } from '@/lib/cx.ts'

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-2">{children}</div>
      {hint && <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>}
    </label>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
  autoFocus,
  onKeyDown,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'email' | 'password'
  autoComplete?: string
  autoFocus?: boolean
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-line-strong bg-bg-inset px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-accent"
    />
  )
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  return (
    <div className="flex items-center border border-line-strong bg-bg-inset focus-within:border-accent">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 0, min, max))}
        className="w-full bg-transparent px-3 py-2.5 text-sm text-ink outline-none tnum [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && <span className="px-3 font-mono text-xs text-ink-faint">{suffix}</span>}
    </div>
  )
}

function clamp(v: number, min?: number, max?: number) {
  if (min != null && v < min) return min
  if (max != null && v > max) return max
  return v
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 20,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  return (
    <div className="inline-flex items-stretch border border-line-strong bg-bg-inset">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="px-3.5 py-2 text-ink-dim hover:bg-bg-raised hover:text-ink"
      >
        –
      </button>
      <span className="flex min-w-10 items-center justify-center border-x border-line-strong px-2 text-sm tnum">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="px-3.5 py-2 text-ink-dim hover:bg-bg-raised hover:text-ink"
      >
        +
      </button>
    </div>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex flex-wrap border border-line-strong">
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'px-3.5 py-2 font-mono text-xs uppercase tracking-[0.1em] transition-colors',
            i > 0 && 'border-l border-line-strong',
            value === o.value ? 'bg-accent text-white' : 'text-ink-dim hover:bg-bg-raised hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cx(
        'flex w-full items-start gap-3 border p-3 text-left transition-colors',
        checked ? 'border-accent bg-accent/5' : 'border-line hover:border-line-strong',
      )}
    >
      <span
        className={cx(
          'mt-0.5 flex h-4 w-4 flex-none items-center justify-center border',
          checked ? 'border-accent bg-accent text-white' : 'border-line-strong',
        )}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-faint">{hint}</span>}
      </span>
    </button>
  )
}

export function CardChoice<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; title: string; body: string; soon?: boolean }[]
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            disabled={o.soon}
            onClick={() => onChange(o.value)}
            className={cx(
              'relative border p-4 text-left transition-colors',
              o.soon && 'cursor-not-allowed opacity-45',
              active ? 'border-accent bg-accent/5' : 'border-line hover:border-line-strong',
            )}
          >
            {o.soon && (
              <span className="absolute right-3 top-3 border border-line-strong px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
                Soon
              </span>
            )}
            {active && (
              <span className="absolute right-3 top-3 flex h-4 w-4 items-center justify-center bg-accent text-white">
                <Check size={11} strokeWidth={3} />
              </span>
            )}
            <div className="font-display text-lg">{o.title}</div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">{o.body}</p>
          </button>
        )
      })}
    </div>
  )
}
