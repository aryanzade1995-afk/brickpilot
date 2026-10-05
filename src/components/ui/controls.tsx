import { createContext, useContext, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cx } from '@/lib/cx.ts'

const FieldLabel = createContext<string | null>(null)

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
    <div role="group" aria-label={label} className="block">
      <span className="label">{label}</span>
      <FieldLabel.Provider value={label}><div className="mt-2">{children}</div></FieldLabel.Provider>
      {hint && <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>}
    </div>
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
  const fieldLabel = useContext(FieldLabel)
  return (
    <input
      aria-label={fieldLabel ?? undefined}
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
  const fieldLabel = useContext(FieldLabel)
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const precision = String(step).split('.')[1]?.length ?? 0
  const changeBy = (delta: number) => {
    const base = editing && draft.trim() && Number.isFinite(Number(draft)) ? Number(draft) : value
    const next = clamp(Number((base + delta).toFixed(precision)), min, max)
    setDraft(String(next))
    setEditing(false)
    onChange(next)
  }
  const finish = () => {
    const parsed = Number(draft)
    const next = draft.trim() && Number.isFinite(parsed) ? clamp(parsed, min, max) : value
    setDraft(String(next))
    setEditing(false)
    if (next !== value) onChange(next)
  }
  return (
    <div className="flex items-center border border-line-strong bg-bg-inset focus-within:border-accent">
      <button type="button" aria-label={`Decrease ${fieldLabel ?? 'value'} by ${step}`} disabled={min != null && value <= min}
        onClick={() => changeBy(-step)}
        className="border-r border-line-strong px-2.5 py-2.5 text-sm text-ink-dim hover:bg-bg-raised hover:text-ink disabled:opacity-30">−</button>
      <input
        aria-label={fieldLabel ?? 'Value'}
        type="text"
        inputMode="decimal"
        value={editing ? draft : String(value)}
        onFocus={() => { setDraft(String(value)); setEditing(true) }}
        onChange={(e) => {
          const raw = e.target.value
          if (!/^-?\d*\.?\d*$/.test(raw)) return
          setDraft(raw)
          const parsed = Number(raw)
          if (raw.trim() && Number.isFinite(parsed) && (min == null || parsed >= min) && (max == null || parsed <= max))
            onChange(parsed)
        }}
        onBlur={finish}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        className="min-w-0 w-full bg-transparent px-2 py-2.5 text-center text-sm text-ink outline-none tnum"
      />
      {suffix && <span className="pr-1 font-mono text-xs text-ink-faint">{suffix}</span>}
      <button type="button" aria-label={`Increase ${fieldLabel ?? 'value'} by ${step}`} disabled={max != null && value >= max}
        onClick={() => changeBy(step)}
        className="border-l border-line-strong px-2.5 py-2.5 text-sm text-ink-dim hover:bg-bg-raised hover:text-ink disabled:opacity-30">+</button>
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
  increaseDisabled = false,
  increaseReason,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  increaseDisabled?: boolean
  increaseReason?: string
  max?: number
}) {
  const fieldLabel = useContext(FieldLabel)
  return (
    <div className="inline-flex items-stretch border border-line-strong bg-bg-inset">
      <button
        type="button"
        aria-label={`Decrease ${fieldLabel ?? 'value'}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="px-3.5 py-2 text-ink-dim hover:bg-bg-raised hover:text-ink disabled:opacity-30"
      >
        –
      </button>
      <span className="flex min-w-10 items-center justify-center border-x border-line-strong px-2 text-sm tnum">
        {value}
      </span>
      <button
        type="button"
        aria-label={`Increase ${fieldLabel ?? 'value'}`}
        disabled={value >= max || increaseDisabled}
        title={increaseDisabled ? increaseReason : undefined}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="px-3.5 py-2 text-ink-dim hover:bg-bg-raised hover:text-ink disabled:opacity-30"
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
  /** a disabled option cannot be chosen; `title` says why */
  options: { value: T; label: string; disabled?: boolean; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex flex-wrap border border-line-strong">
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'px-3.5 py-2 font-mono text-xs uppercase tracking-[0.1em] transition-colors',
            i > 0 && 'border-l border-line-strong',
            value === o.value ? 'bg-accent text-white' : o.disabled ? 'cursor-not-allowed text-ink-faint line-through' : 'text-ink-dim hover:bg-bg-raised hover:text-ink',
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
  disabled = false,
  disabledReason,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
  disabledReason?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabledReason}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        'flex w-full items-start gap-3 border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45',
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
        {disabled && disabledReason && <span className="mt-1 block text-xs text-ink-dim">{disabledReason}</span>}
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
  options: { value: T; title: string; body: string; soon?: boolean; disabled?: boolean; disabledReason?: string; note?: string }[]
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            disabled={o.soon || o.disabled}
            title={o.disabledReason}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'relative border p-4 text-left transition-colors',
              (o.soon || o.disabled) && 'cursor-not-allowed opacity-45',
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
            {o.disabledReason && <p className="mt-2 text-xs leading-relaxed text-ink-faint">{o.disabledReason}</p>}
            {o.note && <p className="mt-2 inline-block bg-warn/10 px-2 py-0.5 text-[0.7rem] text-warn">{o.note}</p>}
          </button>
        )
      })}
    </div>
  )
}
