import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useState, useRef, useEffect, type ReactNode } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { cx } from '@/lib/cx.ts'

export interface ExportItem {
  id: string
  label: string
  icon?: ReactNode
  ext?: string
  onExport: () => Promise<void> | void
}

export interface ExportDropdownProps {
  label?: string
  items: ExportItem[]
  align?: 'left' | 'right'
  size?: 'sm' | 'md'
  floating?: boolean
  className?: string
  title?: string
}

export function ExportDropdown({
  label = 'Download',
  items,
  align = 'right',
  size = 'md',
  floating = false,
  className = '',
  title = 'Download Options',
}: ExportDropdownProps) {
  useLanguage(s => s.language)

  const [open, setOpen] = useState(false)
  const [activeItem, setActiveItem] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleSelect = async (item: ExportItem) => {
    if (activeItem) return
    setActiveItem(item.id)
    try {
      await item.onExport()
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setActiveItem(null)
      setOpen(false)
    }
  }

  const isSmall = size === 'sm'

  return (
    <div
      ref={containerRef}
      className={cx(
        'relative inline-block text-left',
        floating && 'pointer-events-auto shadow-md',
        className
      )}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={translateUi(title)}
        onClick={() => setOpen((prev) => !prev)}
        disabled={!!activeItem}
        className={cx(
          'flex items-center gap-1.5 border border-line bg-bg font-mono uppercase tracking-[0.08em] transition-colors',
          'hover:border-accent hover:text-accent focus:outline-hidden focus:border-accent disabled:opacity-50',
          isSmall ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs',
          floating && 'rounded bg-bg-raised/95 backdrop-blur-xs'
        )}
      >
        {activeItem ? (
          <Loader2 size={isSmall ? 11 : 13} className="animate-spin text-accent" />
        ) : (
          <Download size={isSmall ? 11 : 13} className="text-ink-dim" />
        )}
        <span>{translateUi(label)}</span>
        <span className="text-[9px] text-ink-faint">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={translateUi(title)}
          className={cx(
            'absolute z-50 mt-1 min-w-[190px] rounded border border-line bg-bg-raised py-1 shadow-xl backdrop-blur-xs focus:outline-hidden',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {items.map((item) => {
            const isBusy = activeItem === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={!!activeItem}
                onClick={() => void handleSelect(item)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-ink transition-colors hover:bg-bg-inset hover:text-accent disabled:opacity-50"
              >
                <span className="flex items-center gap-2 truncate">
                  {isBusy ? (
                    <Loader2 size={12} className="animate-spin text-accent" />
                  ) : item.icon ? (
                    <span className="flex-none text-ink-dim">{item.icon}</span>
                  ) : (
                    <Download size={12} className="flex-none text-ink-dim" />
                  )}
                  <span className="truncate">{translateUi(item.label)}</span>
                </span>
                {item.ext && (
                  <span className="font-mono text-[10px] text-ink-faint uppercase flex-none">
                    {item.ext}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
