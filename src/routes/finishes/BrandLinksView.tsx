import { useState, useRef, useEffect } from 'react'
import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import {
  getBrandLinks,
  searchBrandLinks,
  isNoLinkNeeded,
  type BrandLink,
  type RelatedMaterial,
  type BrandSearchResult,
} from '@/lib/finishes/brandLinks.ts'
import type { SpecItem, SpecOption } from '@/lib/cost/workspace.ts'
import { cx } from '@/lib/cx.ts'

const DISCLAIMER_TOOLTIP = "Opens the manufacturer's website. Prices and availability there may differ from this concept estimate."

export function BrandLinkRow({
  item,
  option,
}: {
  item: SpecItem
  option?: SpecOption | null
}) {
  useLanguage(s => s.language)
  const [open, setOpen] = useState(false)
  const [activeChip, setActiveChip] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (isNoLinkNeeded(item.id)) return null

  const brandResult = getBrandLinks(item, option)
  const links: BrandLink[] = [...brandResult]
  const relatedMaterials: RelatedMaterial[] = brandResult.relatedMaterials

  if (!links.length && !relatedMaterials.length) return null

  const primary = links[0]
  const remaining = links.slice(1)

  return (
    <div className="mt-2 text-xs font-sans">
      {/* Primary link row */}
      {primary && (
        <div className="relative inline-flex flex-wrap items-center gap-2">
          <a
            href={primary.url}
            target="_blank"
            rel="noopener noreferrer"
            title={translateUi(DISCLAIMER_TOOLTIP)}
            aria-label={translateUi(`View ${item.label} on ${primary.name}`)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-inset/70 px-2.5 py-1 text-xs font-sans font-medium text-ink shadow-xs transition-all hover:border-ink hover:bg-bg hover:shadow-sm"
          >
            <span>{translateUi(`View on ${primary.name}`)}</span>
            <span className="font-sans text-accent" aria-hidden="true">↗</span>
          </a>

          {remaining.length > 0 && (
            <div className="relative inline-block" ref={popoverRef}>
              <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-label={translateUi(`Show ${remaining.length} more brand links for ${item.label}`)}
                className="inline-flex items-center rounded-md border border-line bg-bg px-2 py-1 text-xs font-sans font-medium text-ink-dim transition-colors hover:border-ink hover:bg-bg-inset hover:text-ink"
              >
                +{remaining.length} {translateUi("more")}
              </button>

              {open && (
                <div
                  role="dialog"
                  aria-label={translateUi(`${item.label} manufacturer links`)}
                  className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-line bg-bg p-3 shadow-lg"
                >
                  <p className="mb-2 text-[10px] font-sans font-medium text-ink-dim uppercase tracking-wider">
                    {translateUi("Manufacturer & reference websites")}
                  </p>
                  <ul className="space-y-1.5">
                    {links.map(b => (
                      <li key={b.url}>
                        <a
                          href={b.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={translateUi(DISCLAIMER_TOOLTIP)}
                          aria-label={translateUi(`Visit ${b.name} website`)}
                          className="flex items-center justify-between rounded-md border border-line/60 bg-bg-inset/40 px-2.5 py-1.5 text-xs font-sans font-medium text-ink transition-all hover:border-ink hover:bg-bg"
                        >
                          <span>{b.name}</span>
                          <span className="font-sans text-accent">↗</span>
                        </a>
                        {b.note && (
                          <span className="mt-0.5 block px-1 text-[10px] font-sans text-ink-faint leading-tight">
                            {translateUi(b.note)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 border-t border-line pt-2 text-[9px] font-sans text-ink-faint leading-tight">
                    {translateUi(DISCLAIMER_TOOLTIP)}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Related materials chips */}
      {relatedMaterials.length > 0 && (
        <div className="mt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {relatedMaterials.map(rm => (
              <button
                key={rm.label}
                type="button"
                onClick={() => setActiveChip(activeChip === rm.label ? null : rm.label)}
                aria-expanded={activeChip === rm.label}
                className={cx(
                  'rounded-md border px-2 py-0.5 text-[11px] font-sans font-medium transition-colors',
                  activeChip === rm.label
                    ? 'border-ink bg-bg-inset text-ink font-semibold'
                    : 'border-line text-ink-dim hover:border-ink hover:text-ink hover:bg-bg-inset'
                )}
              >
                {activeChip === rm.label ? '− ' : '+ '}{translateUi(rm.label)}
              </button>
            ))}
          </div>

          {activeChip && (
            <div className="mt-2 rounded-lg border border-line bg-bg-inset/40 p-2.5 text-[11px] font-sans">
              {(() => {
                const found = relatedMaterials.find(rm => rm.label === activeChip)
                if (!found) return null
                return (
                  <div>
                    <span className="font-sans font-medium text-ink block mb-1.5">
                      {translateUi(found.label)}:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {found.brands.map(b => (
                        <a
                          key={b.url}
                          href={b.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={translateUi(DISCLAIMER_TOOLTIP)}
                          aria-label={translateUi(`View ${found.label} on ${b.name}`)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg px-2.5 py-1 text-xs font-sans font-medium text-ink shadow-xs transition-colors hover:border-ink hover:bg-bg-inset"
                        >
                          <span>{b.name}</span>
                          <span className="font-sans text-accent">↗</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Full brand links display for the Change drawer in SpecificationPanel */
export function BrandLinksDetail({
  item,
  option,
}: {
  item: SpecItem
  option?: SpecOption | null
}) {
  useLanguage(s => s.language)

  if (isNoLinkNeeded(item.id)) return null

  const brandResult = getBrandLinks(item, option)
  const links: BrandLink[] = [...brandResult]
  const relatedMaterials: RelatedMaterial[] = brandResult.relatedMaterials

  if (!links.length && !relatedMaterials.length) return null

  return (
    <div className="mt-5 border-t border-line pt-4 space-y-4 font-sans">
      <div>
        <h4 className="font-display text-sm font-normal">
          {translateUi("Reference manufacturers & official websites")}
        </h4>
        <p className="mt-1 text-[11px] font-sans text-ink-faint leading-relaxed">
          {translateUi("Explore verified manufacturer product finders, catalogues and official standards. ")}
          {translateUi(DISCLAIMER_TOOLTIP)}
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {links.map(b => (
            <a
              key={b.url}
              href={b.url}
              target="_blank"
              rel="noopener noreferrer"
              title={translateUi(DISCLAIMER_TOOLTIP)}
              aria-label={translateUi(`Open ${b.name} website`)}
              className="group flex flex-col justify-between rounded-lg border border-line bg-bg-inset/40 p-3 text-left transition-all hover:border-ink hover:bg-bg hover:shadow-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-sans font-medium text-ink group-hover:underline">
                  {b.name}
                </span>
                <span className="inline-flex items-center justify-center rounded-md border border-line bg-bg px-1.5 py-0.5 text-[10px] font-sans font-medium text-accent shadow-xs group-hover:border-ink">
                  ↗
                </span>
              </div>
              <span className="mt-1.5 block text-[11px] font-sans text-ink-dim font-normal">
                {translateUi(b.note ?? (b.kind === 'product-finder' ? 'Specific product' : 'Brand / collection reference'))}
              </span>
            </a>
          ))}
        </div>
      </div>

      {relatedMaterials.length > 0 && (
        <div className="border-t border-line/60 pt-3 font-sans">
          <h5 className="text-xs font-sans font-medium text-ink-dim mb-2">
            {translateUi("Related materials & accessories")}
          </h5>
          <div className="space-y-3">
            {relatedMaterials.map(rm => (
              <div key={rm.label} className="rounded-lg border border-line/70 bg-bg-inset/30 p-2.5">
                <p className="text-xs font-sans font-medium text-ink mb-1.5">{translateUi(rm.label)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {rm.brands.map(b => (
                    <a
                      key={b.url}
                      href={b.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={translateUi(DISCLAIMER_TOOLTIP)}
                      aria-label={translateUi(`View ${rm.label} on ${b.name}`)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg px-2.5 py-1 text-xs font-sans font-medium text-ink shadow-xs transition-colors hover:border-ink hover:bg-bg-inset"
                    >
                      <span>{b.name}</span>
                      <span className="font-sans text-accent">↗</span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Global "Find brands" search box placed in the page header */
export function BrandSearchBar({
  onSelectSection,
}: {
  onSelectSection?: (groupId: string) => void
}) {
  useLanguage(s => s.language)
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const results: BrandSearchResult[] = query.trim() ? searchBrandLinks(query) : []

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="relative w-full max-w-sm" ref={containerRef}>
      <label className="block text-xs text-ink-dim mb-1">
        {translateUi("Find brands")}
      </label>
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => query.trim() && setIsOpen(true)}
          placeholder={translateUi("Search manufacturer websites (cement, fan, tile adhesive)…")}
          className="w-full border border-line bg-bg px-3 py-2 text-xs placeholder:text-ink-faint rounded"
          aria-label={translateUi("Find brand and material websites")}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setIsOpen(false)
            }}
            aria-label={translateUi("Clear brand search")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>

      {isOpen && query.trim() && (
        <div
          role="region"
          aria-label={translateUi("Brand search results")}
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-lg border border-line bg-bg p-3 shadow-xl"
        >
          <div className="flex items-center justify-between pb-2 border-b border-line text-[11px] text-ink-dim">
            <span>
              {translateUi(results.length)} {translateUi("matching brand websites")}
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="underline text-[10px]"
            >
              {translateUi("Close")}
            </button>
          </div>

          {!results.length ? (
            <p className="py-4 text-xs text-ink-dim text-center">
              {translateUi("No matching brands found. Try searching for cement, tile adhesive, fan, wiring or paint.")}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line/60">
              {results.slice(0, 15).map((r, i) => (
                <li key={`${r.groupId}:${r.itemId ?? ''}:${r.brand.url}:${i}`} className="py-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <a
                        href={r.brand.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={translateUi(DISCLAIMER_TOOLTIP)}
                        aria-label={translateUi(`Visit ${r.brand.name} website`)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-inset/70 px-2.5 py-1 text-xs font-sans font-medium text-ink shadow-xs transition-colors hover:border-ink hover:bg-bg"
                      >
                        <span>{r.brand.name}</span>
                        <span className="font-sans text-accent">↗</span>
                      </a>
                      <p className="text-[10px] text-ink-faint mt-0.5">
                        {r.relatedLabel ? `${r.relatedLabel} · ` : ''}
                        {r.itemLabel ? `${r.itemLabel} · ` : ''}
                        {r.groupLabel}
                        {r.brand.note ? ` — ${r.brand.note}` : ''}
                      </p>
                    </div>
                    {onSelectSection && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectSection(r.groupId)
                          setIsOpen(false)
                        }}
                        className="shrink-0 text-[10px] text-ink-dim underline hover:text-ink"
                      >
                        {translateUi("Go to section")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t border-line pt-2 text-[9px] text-ink-faint">
            {translateUi(DISCLAIMER_TOOLTIP)}
          </p>
        </div>
      )}
    </div>
  )
}
