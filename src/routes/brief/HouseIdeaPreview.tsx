import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useState, useRef, useMemo } from 'react'
import { useStudio } from '@/state/studio.ts'
import { Download, Layers, ZoomIn, ZoomOut, RotateCcw, Eye } from 'lucide-react'
import { compile } from '@/lib/model/canonical.ts'
import { generate } from '@/lib/engine/generate.ts'
import { defaultBrief } from '@/lib/model/brief.ts'
import { captureCanvasPng } from '@/lib/export/index.ts'
import { HouseIdeaViewport, type HouseViewAngle } from './HouseIdeaViewport.tsx'
import type { Character } from '@/lib/model/themes.ts'

export function HouseIdeaPreview() {
  useLanguage((s) => s.language)

  const brief = useStudio((s) => s.brief)
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1023px)').matches,
  )
  const [zoom, setZoom] = useState(1)
  const [viewAngle, setViewAngle] = useState<HouseViewAngle>('collage')
  const containerRef = useRef<HTMLDivElement | null>(null)

  // 1. Building Typology (Scale)
  const typeLabel = brief.project.buildingType === 'large-villa' ? 'Large villa' : 'Villa / bungalow'

  // 2. Levels / Storeys
  const storeysLabel = brief.levels.storeys === 0 ? 'Ground only' : `G+${brief.levels.storeys}`

  // 3. Size of House (Selected dimensions)
  const plotDimensions = `${brief.site.plotWidth} × ${brief.site.plotDepth} m plot`
  const sizeSubtitle = `${typeLabel} · ${storeysLabel} · ${plotDimensions}`

  // 4. Character & Style - handles both current and legacy enum ids
  const isCourtyard =
    brief.style.character === 'courtyard-indian' || (brief.style.character as string) === 'courtyard'
  const isContemporary =
    brief.style.character === 'contemporary-indian' || (brief.style.character as string) === 'contemporary'
  const isModernBox = brief.style.character === 'modern-box'

  const charLabel = isCourtyard
    ? 'Courtyard'
    : isContemporary
    ? 'Contemporary'
    : 'Modern Box'

  const characterKey: Character = isCourtyard
    ? 'courtyard-indian'
    : isContemporary
    ? 'contemporary-indian'
    : 'modern-box'

  // 5. Villa Composition
  const compositionLabel =
    isModernBox && brief.style.composition
      ? brief.style.composition === 'glazed-bay'
        ? 'Glazed central bay'
        : brief.style.composition === 'staggered-wings'
        ? 'Staggered wings'
        : brief.style.composition === 'terraced-villa'
        ? 'Terraced villa'
        : 'Automatic'
      : 'Automatic'

  // 6. Villa Layout (Wings) - comes from brief.style.massing
  const rawMassing = brief.style.massing ?? 'auto'
  const wingLabel =
    rawMassing === 'twin-wing' || (rawMassing as string) === 'twin-wings'
      ? 'Twin wings'
      : rawMassing === 'u-wing' || (rawMassing as string) === 'u-wings'
      ? 'U wings'
      : rawMassing === 'courtyard-ring' || (rawMassing as string) === 'courtyard-wings'
      ? 'Courtyard wings'
      : rawMassing === 'pavilion'
      ? 'Pavilion'
      : 'Auto'

  // Single clean combination string
  const selectedCombination = `${typeLabel} | ${charLabel} | ${compositionLabel} | ${wingLabel}`

  // Zoom helpers
  const handleZoomIn = () => setZoom((z) => Math.min(2.0, Math.round((z + 0.2) * 10) / 10))
  const handleZoomOut = () => setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))
  const handleResetZoom = () => setZoom(1)

  // High-DPI Snapshot download
  const handleDownload = async () => {
    const canvas = containerRef.current?.querySelector('canvas')
    if (canvas) {
      await captureCanvasPng(
        canvas,
        `formstead-house-${charLabel.toLowerCase().replace(/\s+/g, '-')}-${wingLabel.toLowerCase().replace(/\s+/g, '-')}.png`,
      )
    }
  }

  // Compile & generate 3D Design for the current combination
  const design = useMemo(() => {
    try {
      const canon = compile(brief)
      const rawMass = brief.style.massing ?? 'auto'
      return generate(canon, { massing: rawMass as any, seed: brief.variation ?? 7 })
    } catch (err) {
      console.warn('Fallback brief compile for 3D preview:', err)
      const b = defaultBrief()
      b.project.buildingType = brief.project.buildingType
      b.style.character = characterKey
      b.style.massing = brief.style.massing
      b.levels.storeys = brief.levels.storeys
      b.site.plotWidth = brief.site.plotWidth
      b.site.plotDepth = brief.site.plotDepth
      return generate(compile(b), { massing: (brief.style.massing ?? 'auto') as any, seed: 7 })
    }
  }, [
    brief,
    characterKey,
  ])

  // Dynamic Architectural Highlights matching the exact character and layout descriptions
  const getHighlights = () => {
    // 1. Facade & Character (Modern Box vs Contemporary vs Courtyard)
    let facade =
      'Crisp white boxes, the upper floor oversailing full-height glass, glass rails and a roof terrace.'
    if (isContemporary) {
      facade =
        'Plaster planes over a stone-clad ground floor, wide sliding glass, deep flat hoods and a double-height entry.'
    } else if (isCourtyard) {
      facade =
        'An open-to-sky garden enclosed by room wings and inward-facing galleries, with warm stone and shaded screens.'
    }

    // 2. Spatial Flow based on Wing layout
    let flow = 'Unified single-core layout maximizing continuous living spaces and setback lawn.'
    if (rawMassing === 'twin-wing' || (rawMassing as string) === 'twin-wings') {
      flow =
        'Two parallel residential wings separate private family suites from active living zones with an open garden in between.'
    } else if (rawMassing === 'u-wing' || (rawMassing as string) === 'u-wings') {
      flow =
        'Three-sided U-shape frames a wind-protected, intimate pool court shielded from neighbors.'
    } else if (rawMassing === 'courtyard-ring' || (rawMassing as string) === 'courtyard-wings') {
      flow =
        'Four-sided cloister wraps around an open-to-sky central courtyard lightwell for traditional microclimate cooling.'
    } else if (rawMassing === 'pavilion') {
      flow =
        'Separate master and entertaining pavilions connected by a transparent glass breezeway link.'
    }

    // 3. Outdoor Living, Roof & Daylighting
    let outdoor =
      'Sage-green flat roof deck with pergola louvers, rooftop services mumty, and 360° views.'
    if (isContemporary) {
      outdoor =
        'Deep floating horizontal eaves, warm teak wood batten panels, and poolside stone patio.'
    } else if (isCourtyard) {
      outdoor =
        'Inward-facing shaded balconies and geometric jaali ventilation screens for thermal comfort.'
    }
    if (typeLabel === 'Large villa') {
      outdoor += ' Sized with expansive wing spans for grand entertaining.'
    }

    return { facade, flow, outdoor }
  }

  const highlights = getHighlights()

  return (
    <aside
      aria-label={translateUi('Basic House Idea Preview')}
      data-theme="light"
      className="brief-house-preview z-[5] max-h-[calc(100dvh-var(--brief-rail-height)-32px)] overflow-y-auto border border-line bg-white p-4 shadow-sm text-ink rounded-none"
      style={{ backgroundColor: '#ffffff', color: '#171717' }}
    >
      {/* Header Bar */}
      <div className="flex items-start justify-between gap-2 border-b border-line pb-3">
        <div>
          <p className="label text-[11px] font-mono uppercase tracking-[0.1em] text-neutral-500">
            {translateUi('House Preview')}
          </p>
          <h2 className="mt-1 font-display text-xl leading-tight text-neutral-900 font-semibold">
            {translateUi('Basic House Idea')}
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">{translateUi(sizeSubtitle)}</p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-xs font-mono uppercase tracking-wider text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
        >
          {translateUi(collapsed ? 'Expand' : 'Collapse')}
        </button>
      </div>

      <div className={collapsed ? 'hidden' : 'mt-3 space-y-3'}>
        {/* Camera Angle Selector Bar */}
        <div className="flex items-center justify-between gap-1 border-b border-neutral-200 pb-2">
          <div className="flex items-center gap-1">
            <Eye size={12} className="text-neutral-500" />
            <span className="text-[11px] font-mono uppercase text-neutral-500 font-medium">
              {translateUi('Angle:')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {(
              [
                { id: 'collage', label: 'Hero 3/4' },
                { id: 'front', label: 'Front' },
                { id: 'top', label: 'Aerial' },
                { id: 'orbit', label: '3D Orbit' },
              ] as const
            ).map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setViewAngle(v.id)}
                aria-pressed={viewAngle === v.id}
                className={`px-2 py-0.5 text-[11px] font-mono transition-colors ${
                  viewAngle === v.id
                    ? 'bg-neutral-900 text-white font-semibold'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                {translateUi(v.label)}
              </button>
            ))}
          </div>
        </div>

        {/* [ THE BIG BOX FOR IMAGE / 3D ARCHITECTURAL MODEL ] */}
        <div className="group relative aspect-[16/11.5] w-full overflow-hidden border border-neutral-200 bg-[#1E2224]">
          {/* 3D WebGL Canvas */}
          <HouseIdeaViewport
            design={design}
            character={characterKey}
            view={viewAngle}
            zoom={zoom}
            containerRef={containerRef}
          />

          {/* Badges Overlay */}
          <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5 pointer-events-none">
            <span className="border border-neutral-200 bg-white/95 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-neutral-800 backdrop-blur-sm shadow-xs font-semibold">
              {charLabel}
            </span>
            <span className="border border-emerald-300 bg-emerald-900/90 text-white px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider backdrop-blur-sm shadow-xs font-medium">
              {wingLabel}
            </span>
          </div>

          {/* Interactive Zoom Controls & Snapshot Download */}
          <div className="absolute right-2.5 top-2.5 flex items-center gap-1">
            <button
              type="button"
              onClick={handleZoomIn}
              title={translateUi('Zoom in')}
              aria-label={translateUi('Zoom in')}
              className="flex h-7 w-7 items-center justify-center border border-neutral-200 bg-white/90 text-neutral-700 hover:bg-white hover:text-neutral-950 backdrop-blur-sm shadow-xs transition-colors"
            >
              <ZoomIn size={13} />
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              title={translateUi('Zoom out')}
              aria-label={translateUi('Zoom out')}
              className="flex h-7 w-7 items-center justify-center border border-neutral-200 bg-white/90 text-neutral-700 hover:bg-white hover:text-neutral-950 backdrop-blur-sm shadow-xs transition-colors"
            >
              <ZoomOut size={13} />
            </button>
            {zoom !== 1 && (
              <button
                type="button"
                onClick={handleResetZoom}
                title={translateUi('Reset zoom')}
                aria-label={translateUi('Reset zoom')}
                className="flex h-7 px-1.5 items-center justify-center border border-neutral-200 bg-white/90 text-neutral-700 hover:bg-white hover:text-neutral-950 text-[10px] font-mono backdrop-blur-sm shadow-xs transition-colors"
              >
                <RotateCcw size={10} className="mr-0.5" />
                100%
              </button>
            )}
            <button
              type="button"
              onClick={handleDownload}
              title={translateUi('Download 3D Snapshot')}
              aria-label={translateUi('Download 3D Snapshot')}
              className="flex h-7 w-7 items-center justify-center border border-neutral-200 bg-white/90 text-neutral-700 hover:bg-white hover:text-neutral-950 backdrop-blur-sm shadow-xs transition-colors"
            >
              <Download size={12} />
            </button>
          </div>

          {/* Bottom Elements Caption */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-neutral-900/60 px-3 py-1 text-[10px] font-mono text-white/90 backdrop-blur-xs">
            <span>
              {viewAngle === 'orbit'
                ? translateUi('Drag mouse to orbit · Scroll to zoom')
                : translateUi('Realtime 3D Architectural Massing')}
            </span>
            <span className="font-mono text-[9px] text-white/70">
              {Math.round(zoom * 100)}% · {viewAngle.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Architectural Highlights tailored to this specific combination */}
        <div className="space-y-1.5 pt-2 border-t border-neutral-200">
          <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 font-semibold">
            {translateUi('Architectural Highlights:')}
          </p>
          <div className="space-y-1 text-xs text-neutral-700 bg-neutral-50/80 p-2.5 border border-neutral-200">
            <p className="flex items-start gap-1.5">
              <span className="text-emerald-700 font-bold shrink-0">🏛️</span>
              <span>{translateUi(highlights.facade)}</span>
            </p>
            <p className="flex items-start gap-1.5">
              <span className="text-amber-700 font-bold shrink-0">🌿</span>
              <span>{translateUi(highlights.flow)}</span>
            </p>
            <p className="flex items-start gap-1.5">
              <span className="text-sky-700 font-bold shrink-0">☀️</span>
              <span>{translateUi(highlights.outdoor)}</span>
            </p>
          </div>
        </div>

        {/* At Bottom: The Combination They Have Selected (Written Once Cleanly) */}
        <div className="space-y-1.5 pt-2 border-t border-neutral-200">
          <div className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-neutral-500 font-medium">
            <Layers size={12} className="text-neutral-400" />
            <span>{translateUi('Selected Combination:')}</span>
          </div>

          <div className="border border-neutral-200 bg-neutral-50 p-2.5">
            <p className="font-mono text-xs font-semibold text-neutral-900 leading-snug">
              {selectedCombination}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="border border-neutral-900 bg-neutral-900 text-white px-2 py-0.5 text-[10px] font-medium">
                {typeLabel}
              </span>
              <span className="border border-neutral-300 bg-white px-2 py-0.5 text-[10px] text-neutral-700 font-sans">
                {charLabel}
              </span>
              <span className="border border-neutral-300 bg-white px-2 py-0.5 text-[10px] text-neutral-700 font-sans">
                {compositionLabel}
              </span>
              <span className="border border-emerald-600 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-800 font-medium font-sans">
                Wing: {wingLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <div className="flex items-center justify-between border-t border-neutral-200 pt-2 text-[10px] font-mono text-neutral-400">
          <span>{translateUi('Interactive 3D · 0% Idle GPU')}</span>
          <span>{translateUi('Architectural Massing Model')}</span>
        </div>
      </div>
    </aside>
  )
}
