import { useState, type FC } from 'react'
import { Sparkles, Check, RotateCcw } from 'lucide-react'

export interface AutoFillChipProps {
  label: string
  value: string | number
  onClick: () => void
  isOverridden?: boolean
  disabled?: boolean
  className?: string
}

export const AutoFillChip: FC<AutoFillChipProps> = ({
  label,
  value,
  onClick,
  isOverridden = false,
  disabled = false,
  className = '',
}) => {
  const [copied, setCopied] = useState(false)

  const handleAction = () => {
    if (disabled) return
    onClick()
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={handleAction}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs transition-all focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 cursor-pointer min-h-[34px] ${
        isOverridden
          ? 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100'
          : 'border-line bg-bg-raised text-ink-dim hover:border-accent hover:bg-bg-inset hover:text-ink'
      } ${className}`}
      title={isOverridden ? `Reset ${label} to auto-calculated value (${value})` : `Auto-calculated ${label}: ${value}`}
    >
      {copied ? (
        <Check size={13} className="text-emerald-700" aria-hidden />
      ) : isOverridden ? (
        <RotateCcw size={12} className="text-amber-800" aria-hidden />
      ) : (
        <Sparkles size={13} className="text-accent" aria-hidden />
      )}
      <span className="text-ink-faint">{label}:</span>
      <span className="font-semibold text-ink">{value}</span>
      {isOverridden ? (
        <span className="rounded bg-amber-200/80 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
          Reset to auto
        </span>
      ) : copied ? (
        <span className="text-xs font-semibold text-emerald-700">Restored</span>
      ) : null}
    </button>
  )
}
