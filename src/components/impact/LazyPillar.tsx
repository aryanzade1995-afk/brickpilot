import { useEffect, useRef, useState, type ReactNode } from 'react'

interface LazyPillarProps {
  id: string
  minHeight?: string | number
  children: ReactNode
}

export function LazyPillar({ id, minHeight = 550, children }: LazyPillarProps) {
  const isDirectTarget =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('tab') === id

  const [isVisible, setIsVisible] = useState(isDirectTarget)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isVisible) return
    const el = containerRef.current
    if (!el) return

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px 0px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [isVisible])

  return (
    <div
      ref={containerRef}
      id={`lazy-container-${id}`}
      style={{ minHeight: isVisible ? undefined : minHeight }}
      className={isVisible ? '' : 'flex items-center justify-center rounded-2xl border border-line bg-bg-inset/40 p-8 text-center'}
    >
      {isVisible ? (
        children
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className="h-6 w-24 rounded bg-line animate-pulse" />
          <span className="font-mono text-xs text-ink-dim">Loading pillar…</span>
        </div>
      )}
    </div>
  )
}

