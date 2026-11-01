import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowUpRight,
  Download,
  MessageSquareText,
  Upload,
  Sparkles,
  Building2,
  LayoutDashboard,
  Banknote,
  Droplets,
  Sun,
  Accessibility,
  Users,
  FileText,
  Layers,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { useStudio } from '@/state/studio.ts'
import { useProjects, noteChange } from '@/state/projects.ts'
import { useFinishes } from '@/state/finishes.ts'
import { useSocialImpact } from '@/state/socialImpact.ts'
import { useCostResearch } from '@/state/costResearch.ts'
import { estimateProjectBoq, type CostEstimate } from '@/lib/cost/index.ts'
import { geometryCostKey } from '@/lib/cost/quantities.ts'
import { emptyImpact, type ImpactDocument } from '@/lib/impact/schema.ts'
import { analyzeImpact, housingTopic, IMPACT_SOURCES } from '@/lib/impact/analysis.ts'
import { buildImpactSummary } from '@/lib/impact/summary.ts'
import { translate as t, useLanguage } from '@/lib/i18n/index.ts'
import type { Brief } from '@/lib/model/brief.ts'
import { getSampleProjectData } from '@/lib/impact/sampleProject.ts'
import { ImpactHeroBanner } from '@/components/impact/ImpactHeroBanner.tsx'
import { AffordabilityPillar } from '@/components/impact/AffordabilityPillar.tsx'
import { WaterSecurityPillar } from '@/components/impact/WaterSecurityPillar.tsx'
import { ClimateSolarPillar } from '@/components/impact/ClimateSolarPillar.tsx'
import { AccessibilityPillar } from '@/components/impact/AccessibilityPillar.tsx'
import { CommunityPillar } from '@/components/impact/CommunityPillar.tsx'
import { DataSourcesAssumptionsPanel } from '@/components/impact/DataSourcesAssumptionsPanel.tsx'
import { PillarErrorBoundary } from '@/components/impact/PillarErrorBoundary.tsx'

export const IMPACT_TABS = [
  { id: 'overview', n: '01', label: 'Overview & KPIs', sub: 'Cross-Section & Score', icon: LayoutDashboard },
  { id: 'affordability', n: '02', label: 'Affordability & Carbon', sub: 'BOQ Waterfall & Eco-Swaps', icon: Banknote },
  { id: 'water', n: '03', label: 'Water Security', sub: 'Jal Shakti & Cistern Autonomy', icon: Droplets },
  { id: 'climate', n: '04', label: 'Climate & Solar', sub: 'Cool Roof & PM Surya Ghar', icon: Sun },
  { id: 'accessibility', n: '05', label: 'Accessibility & Safety', sub: 'DEPwD 2021 & Life Safety', icon: Accessibility },
  { id: 'community', n: '06', label: 'Community & Scaling', sub: 'PMAY-U 2.0 & Cluster Pilots', icon: Users },
  { id: 'guidance', n: '07', label: 'Housing Guidance', sub: 'Multilingual Q&A Assistant', icon: MessageSquareText },
  { id: 'standards', n: '08', label: 'Statutory Standards', sub: 'By-Laws, Mandates & Sources', icon: FileText },
  { id: 'all', n: '09', label: 'Complete Report', sub: 'Continuous Full-Spectrum Feed', icon: Layers },
] as const

export type ImpactTabId = (typeof IMPACT_TABS)[number]['id']

const button =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-bg-raised px-4 text-xs font-mono font-medium text-ink transition-colors hover:bg-bg-inset focus-visible:outline-2 focus-visible:outline-accent cursor-pointer'

const buttonPrimary =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-transparent bg-ink px-4 text-xs font-mono font-semibold text-white shadow-xs transition-colors hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-accent cursor-pointer'

export function SocialImpact() {
  useLanguage(s => s.language)
  const [params] = useSearchParams()
  const forceEmpty = params.get('empty') === 'true'
  const isSampleParam = params.get('sample') === 'true'
  const studioResult = useStudio(s => s.result)
  const studioBrief = useStudio(s => s.brief)
  const run = useStudio(s => s.run)
  const projectId = useProjects(s => s.currentId)

  const sampleData = useMemo(() => getSampleProjectData(), [])

  // Auto-seed sample if user requested ?sample=true OR if there is no valid studio result and not forcing empty
  const shouldUseSample = isSampleParam || ((!studioResult || !studioResult.report.hardChecksPass) && !forceEmpty)

  const activeResult = shouldUseSample ? sampleData.result : studioResult
  const activeBrief = shouldUseSample ? sampleData.brief : studioBrief

  const saved = useFinishes(s => s.entries[activeResult ? geometryCostKey(activeResult.design) : ''])

  useEffect(() => {
    // If not using sample and no result, generate
    if (!studioResult && !forceEmpty && !isSampleParam) {
      run()
    }
  }, [studioResult, run, forceEmpty, isSampleParam])

  const prepared = useMemo(() => {
    if (!activeResult) return null
    if (shouldUseSample) {
      return { cost: sampleData.cost, error: null }
    }
    if (!activeResult.report.hardChecksPass) return null
    try {
      return { cost: estimateProjectBoq(activeResult.design, activeBrief, saved, activeResult), error: null }
    } catch {
      return {
        cost: null,
        error: 'The current estimate needs review. Open Finishes & Cost before comparing impact.',
      }
    }
  }, [activeResult, activeBrief, saved, shouldUseSample, sampleData])

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-8 md:px-10">
      <WorkspaceTabs />
      <header className="my-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[.2em] text-ink-dim">
            {t('Better homes. Measurable impact.')}
          </p>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-normal tracking-tight text-ink">{t('Social Impact')}</h1>
          <p className="mt-2 max-w-2xl font-sans text-sm sm:text-base text-ink-dim leading-relaxed">
            {t(
              'High-impact visual engineering for your home: 1-click eco-swaps, Jal Shakti monsoon harvesting, Eco-Niwas cool roofs, PM Surya Ghar solar, and DEPwD barrier-free access.'
            )}
          </p>
        </div>
        <span className="rounded-full border border-line bg-bg-raised px-4 py-1.5 text-xs font-mono text-ink-dim shadow-2xs">
          {activeBrief.project.name}
        </span>
      </header>

      {forceEmpty ? (
        <div id="impact-empty-state" className="rounded-2xl border border-line bg-bg-raised p-12 text-center shadow-xs">
          <Building2 className="mx-auto h-12 w-12 text-ink-faint animate-pulse" />
          <h2 className="mt-4 font-display text-2xl font-normal text-ink">{t('Preparing your architectural model…')}</h2>
          <p className="mt-2 font-sans text-sm text-ink-dim max-w-md mx-auto leading-relaxed">
            {t('Generating layout, structural plinth, and bill of quantities for impact calculation.')}
          </p>
          <button
            type="button"
            onClick={() => run()}
            className={`${buttonPrimary} mt-6 mx-auto`}
          >
            <Sparkles size={14} className="text-white" />
            <span className="text-white">{t('Generate House Model')}</span>
          </button>
        </div>
      ) : !activeResult ? (
        <div id="impact-empty-state" className="rounded-2xl border border-line bg-bg-raised p-12 text-center shadow-xs">
          <Building2 className="mx-auto h-12 w-12 text-ink-faint animate-pulse" />
          <h2 className="mt-4 font-display text-2xl font-normal text-ink">{t('Preparing your architectural model…')}</h2>
          <p className="mt-2 font-sans text-sm text-ink-dim max-w-md mx-auto leading-relaxed">
            {t('Generating layout, structural plinth, and bill of quantities for impact calculation.')}
          </p>
          <button
            type="button"
            onClick={() => run()}
            className={`${buttonPrimary} mt-6 mx-auto`}
          >
            <Sparkles size={14} className="text-white" />
            <span className="text-white">{t('Generate House Model')}</span>
          </button>
        </div>
      ) : !activeResult.report.hardChecksPass ? (
        <div className="rounded-2xl border border-line bg-bg-raised p-8 shadow-xs">
          <h2 className="font-display text-2xl font-normal text-ink">{t('Review your plan first')}</h2>
          <p className="mt-2 font-sans text-sm text-ink-dim max-w-xl leading-relaxed">
            {t('Resolve architectural and clearance warnings before calculating statutory impact benchmarks.')}
          </p>
          <Link to="/workspace/plan" className={`${button} mt-4`}>
            {t('Review 2D plan')}
          </Link>
        </div>
      ) : !prepared?.cost ? (
        <div className="rounded-2xl border border-line bg-bg-raised p-8 shadow-xs">
          <p role="status" className="font-sans text-sm text-ink-dim">
            {t(prepared?.error ?? 'Preparing cost estimation…')}
          </p>
        </div>
      ) : (
        <>
          {shouldUseSample && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-600/20 bg-emerald-500/5 px-4 py-3 text-xs shadow-2xs">
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <span className="font-sans font-semibold text-emerald-950 dark:text-emerald-100">
                  {t('Pre-Loaded Sample Project')}:
                </span>
                <span className="font-mono text-xs text-ink-dim">
                  {t('Pune Eco-Villa · 4 Occupants · 10,000 L RWH · 5 kW Solar · 1:12 Barrier-Free Ramp')}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  to="/workspace/brief"
                  className="font-mono text-xs font-medium text-emerald-700 hover:text-emerald-900 underline underline-offset-4 dark:text-emerald-300 dark:hover:text-emerald-200"
                >
                  {t('Customize Brief')} &rarr;
                </Link>
              </div>
            </div>
          )}
          <ImpactWorkspace
            key={projectId ?? (shouldUseSample ? 'sample' : 'draft')}
            result={activeResult}
            brief={activeBrief}
            cost={prepared.cost}
            isSampleMode={shouldUseSample}
            sampleDocument={sampleData.document}
          />
        </>
      )}
    </div>
  )
}

function ImpactWorkspace({
  result,
  brief,
  cost,
  isSampleMode = false,
  sampleDocument,
}: {
  result: NonNullable<ReturnType<typeof useStudio.getState>['result']>
  brief: Brief
  cost: CostEstimate
  isSampleMode?: boolean
  sampleDocument?: ImpactDocument
}) {
  const savedDoc = useSocialImpact(s => s.document)
  const error = useSocialImpact(s => s.error)
  const update = useSocialImpact(s => s.update)
  const restore = useSocialImpact(s => s.restore)
  const doc = useMemo(() => {
    if (isSampleMode && sampleDocument && (!savedDoc || (savedDoc.water.capacityL === null && savedDoc.budgetInr === null))) {
      return sampleDocument
    }
    return savedDoc ?? sampleDocument ?? emptyImpact()
  }, [savedDoc, isSampleMode, sampleDocument])
  const city = useCostResearch(s => s.location.city) ?? 'Pune'
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const initialTab: ImpactTabId = IMPACT_TABS.some(t => t.id === rawTab)
    ? (rawTab as ImpactTabId)
    : 'overview'
  const [activeTab, setActiveTab] = useState<ImpactTabId>(initialTab)
  const tabListRef = useRef<HTMLDivElement>(null)

  // Synchronize tab state with URL parameters (for browser back/forward and direct links)
  useEffect(() => {
    if (rawTab && IMPACT_TABS.some(t => t.id === rawTab)) {
      setActiveTab(rawTab as ImpactTabId)
    } else if (!rawTab) {
      setActiveTab('overview')
    }
  }, [rawTab])

  // Automatically scroll the tab strip so the active tab is visible
  useEffect(() => {
    if (!tabListRef.current) return
    const activeEl = tabListRef.current.querySelector(`[data-tab-id="${activeTab}"]`) as HTMLElement | null
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
    }
  }, [activeTab])

  const scrollTabs = (delta: number) => {
    tabListRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  const setTab = (id: ImpactTabId | string, options?: { scrollIntoView?: boolean }) => {
    const validId = IMPACT_TABS.some(t => t.id === id) ? (id as ImpactTabId) : 'overview'
    setActiveTab(validId)
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev)
        next.set('tab', validId)
        return next
      },
      { replace: true }
    )

    // Smooth scroll the viewport ONLY when navigating from in-page elements (hero cards, directory, bottom pagination)
    if (options?.scrollIntoView) {
      const navEl = document.getElementById('impact-function-nav')
      if (navEl) {
        navEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }

  // Single Source of Truth for every derived number on the page
  const summary = useMemo(() => {
    try {
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0
      const s = buildImpactSummary({
        design: result.design,
        brief,
        cost,
        report: result.report,
        document: doc,
        cityOverride: city,
      })
      if (typeof performance !== 'undefined') {
        const elapsed = performance.now() - t0
        if (import.meta.env?.DEV && elapsed > 16) {
          console.warn(`[Impact] buildImpactSummary took ${elapsed.toFixed(2)} ms (> 16 ms budget)`)
        }
      }
      return s
    } catch (err) {
      console.error('Failed to build impact summary:', err)
      return null
    }
  }, [result.design, result.report, brief, cost, doc, city])

  const analyzed = useMemo(() => {
    try {
      return {
        value: analyzeImpact(result.design, brief, cost, result.report, doc),
        error: null,
      }
    } catch {
      return {
        value: null,
        error: 'Some source geometry needs review. Your home and saved inputs are unchanged.',
      }
    }
  }, [result, brief, cost, doc])

  const save = (next: ImpactDocument) => {
    if (update(next)) noteChange('Social Impact inputs')
  }

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const json = JSON.parse(evt.target?.result as string)
        if (json.format === 'brickpilot-social-impact' || json.format === 'formstead-social-impact') {
          restore(json.inputs ?? json.document)
          noteChange('Imported Social Impact document')
        }
      } catch {
        alert('Invalid impact document format.')
      }
    }
    reader.readAsText(file)
  }

  if (!summary || !analyzed.value) {
    return <p role="status">{t(analyzed.error ?? 'Error building impact metrics.')}</p>
  }
  const data = analyzed.value

  const isolate = searchParams.get('isolate')
  if (isolate) {
    return (
      <div id="isolated-element" className="p-4 bg-bg max-w-5xl mx-auto space-y-4">
        {isolate === 'hero' && (
          <ImpactHeroBanner summary={summary} onSelectPillar={setTab} />
        )}
        {isolate === 'waterfall' && (
          <AffordabilityPillar
            summary={summary.affordability}
            cost={cost}
            brief={brief}
            design={result.design}
            doc={doc}
            onSaveDoc={save}
          />
        )}
        {isolate === 'thermal' && (
          <ClimateSolarPillar
            summary={summary.climate}
            doc={doc}
            onSaveDoc={save}
          />
        )}
        {isolate === 'floordrawing' && (
          <AccessibilityPillar
            summary={summary.accessibility}
            design={result.design}
            model={result.design.model}
            checks={data.checks}
            doc={doc}
            onSaveDoc={save}
          />
        )}
        {isolate === 'watercombo' && (
          <WaterSecurityPillar
            summary={summary.water}
            doc={doc}
            onSaveDoc={save}
          />
        )}
        {isolate === 'communityscale' && (
          <CommunityPillar
            summary={summary.community}
            doc={doc}
            onSaveDoc={save}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-lg border border-line bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
          {t(error)}
        </p>
      )}

      {/* Sticky Functionality Navigation Bar (Glitch-free, dedicated button per function) */}
      <nav
        id="impact-function-nav"
        aria-label="Social Impact Functionalities"
        className="sticky top-0 z-30 rounded-xl border border-line bg-bg/95 backdrop-blur-md p-2 shadow-xs transition-shadow"
      >
        <div className="flex items-center gap-1.5">
          {/* Scroll Left Button */}
          <button
            type="button"
            onClick={() => scrollTabs(-240)}
            aria-label="Scroll tabs left"
            className="hidden sm:flex h-9 w-8 items-center justify-center rounded-lg border border-line bg-bg-raised text-ink-dim hover:text-ink hover:bg-bg-inset transition-colors shrink-0 cursor-pointer"
          >
            <ChevronLeft size={16} />
          </button>

          {/* Horizontal Scrollable Tabs Container */}
          <div
            ref={tabListRef}
            className="flex items-center gap-1.5 overflow-x-auto scroll-smooth py-0.5 px-0.5 flex-1"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {IMPACT_TABS.map(tab => {
              const isActive = activeTab === tab.id
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-tab-id={tab.id}
                  onClick={() => setTab(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`group relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs transition-all cursor-pointer whitespace-nowrap shrink-0 min-h-[40px] select-none focus-visible:outline-2 focus-visible:outline-accent ${
                    isActive
                      ? 'bg-ink text-white font-semibold shadow-xs ring-1 ring-ink'
                      : 'bg-bg-raised text-ink-dim hover:bg-bg-inset hover:text-ink border border-line'
                  }`}
                >
                  <Icon
                    size={14}
                    className={`shrink-0 transition-colors ${
                      isActive ? 'text-white' : 'text-ink-faint group-hover:text-ink'
                    }`}
                    aria-hidden
                  />
                  <span
                    className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                      isActive ? 'bg-white/20 text-white' : 'bg-bg text-ink-dim border border-line/60'
                    }`}
                  >
                    {tab.n}
                  </span>
                  <span className={`font-sans font-medium text-xs tracking-tight ${isActive ? 'text-white' : ''}`}>
                    {tab.label}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Scroll Right Button */}
          <button
            type="button"
            onClick={() => scrollTabs(240)}
            aria-label="Scroll tabs right"
            className="hidden sm:flex h-9 w-8 items-center justify-center rounded-lg border border-line bg-bg-raised text-ink-dim hover:text-ink hover:bg-bg-inset transition-colors shrink-0 cursor-pointer"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Active Module Context Breadcrumb */}
        {(() => {
          const currentTabObj = IMPACT_TABS.find(t => t.id === activeTab) ?? IMPACT_TABS[0]
          const currentIdx = IMPACT_TABS.findIndex(t => t.id === activeTab)
          return (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 px-2 pt-2 text-xs font-sans text-ink-dim">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-accent">Module {currentTabObj.n}</span>
                <span className="text-ink-faint">/</span>
                <span className="font-semibold text-ink">{currentTabObj.label}</span>
                <span className="hidden md:inline text-ink-dim">— {currentTabObj.sub}</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-ink-faint">
                <span>View {currentIdx + 1} of {IMPACT_TABS.length}</span>
                {activeTab !== 'overview' && (
                  <button
                    type="button"
                    onClick={() => setTab('overview')}
                    className="hover:text-ink underline underline-offset-2 ml-2 transition-colors cursor-pointer"
                  >
                    &larr; Overview
                  </button>
                )}
              </div>
            </div>
          )
        })()}
      </nav>

      {/* VIEW 01: Overview & Live KPIs */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          <section id="hero" aria-label="Social Impact Overview Hero">
            <ImpactHeroBanner summary={summary} onSelectPillar={id => setTab(id, { scrollIntoView: true })} />
          </section>

          {/* Directory Cards for All Functional Pillars */}
          <div className="rounded-2xl border border-line bg-bg-raised p-6 shadow-xs">
            <div className="border-b border-line pb-4">
              <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Specialized Tools</span>
              <h3 className="font-display text-2xl font-normal text-ink mt-1">Impact Engineering Modules</h3>
              <p className="font-sans text-sm text-ink-dim mt-1">
                Navigate to individual modules to inspect BOQ eco-swaps, Jal Shakti monsoon harvesting, cool roof conduction, DEPwD accessibility, or PMAY-U 2.0 scaling.
              </p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {IMPACT_TABS.filter(t => t.id !== 'overview' && t.id !== 'all').map(t => {
                const Icon = t.icon
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id, { scrollIntoView: true })}
                    className="flex flex-col items-start rounded-xl border border-line bg-bg p-5 text-left transition-all hover:border-accent hover:bg-bg-inset hover:shadow-xs cursor-pointer group"
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-bg-raised text-ink group-hover:border-accent group-hover:text-accent transition-colors">
                        <Icon size={18} />
                      </span>
                      <span className="font-mono text-xs text-ink-faint">{t.n}</span>
                    </div>
                    <h4 className="font-display text-lg font-medium text-ink mt-3 group-hover:text-accent transition-colors">
                      {t.label}
                    </h4>
                    <p className="font-sans text-xs text-ink-dim mt-1">
                      {t.sub}
                    </p>
                    <span className="mt-4 inline-flex items-center gap-1 font-mono text-xs text-ink-faint group-hover:text-ink transition-colors">
                      Open Module &rarr;
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <TabPagination currentId={activeTab} onNavigate={id => setTab(id, { scrollIntoView: true })} />
        </div>
      )}

      {/* VIEW 02: Affordability & Carbon */}
      {activeTab === 'affordability' && (
        <section id="pillar-affordability" className="min-w-0" aria-label="Affordability Pillar">
          <PillarErrorBoundary pillarName="Affordability">
            <AffordabilityPillar
              summary={summary.affordability}
              cost={cost}
              brief={brief}
              design={result.design}
              doc={doc}
              onSaveDoc={save}
            />
          </PillarErrorBoundary>
          <TabPagination currentId={activeTab} onNavigate={setTab} />
        </section>
      )}

      {/* VIEW 03: Water Security */}
      {activeTab === 'water' && (
        <section id="pillar-water" className="min-w-0" aria-label="Water Security Pillar">
          <PillarErrorBoundary pillarName="Water Security">
            <WaterSecurityPillar
              summary={summary.water}
              doc={doc}
              onSaveDoc={save}
            />
          </PillarErrorBoundary>
          <TabPagination currentId={activeTab} onNavigate={setTab} />
        </section>
      )}

      {/* VIEW 04: Climate & Solar */}
      {activeTab === 'climate' && (
        <section id="pillar-climate" className="min-w-0" aria-label="Climate & Solar Pillar">
          <PillarErrorBoundary pillarName="Climate & Solar">
            <ClimateSolarPillar
              summary={summary.climate}
              doc={doc}
              onSaveDoc={save}
            />
          </PillarErrorBoundary>
          <TabPagination currentId={activeTab} onNavigate={setTab} />
        </section>
      )}

      {/* VIEW 05: Accessibility & Safety */}
      {activeTab === 'accessibility' && (
        <section id="pillar-accessibility" className="min-w-0" aria-label="Accessibility Pillar">
          <PillarErrorBoundary pillarName="Accessibility">
            <AccessibilityPillar
              summary={summary.accessibility}
              design={result.design}
              model={result.design.model}
              checks={data.checks}
              doc={doc}
              onSaveDoc={save}
            />
          </PillarErrorBoundary>
          <TabPagination currentId={activeTab} onNavigate={setTab} />
        </section>
      )}

      {/* VIEW 06: Community & Scaling */}
      {activeTab === 'community' && (
        <section id="pillar-community" className="min-w-0" aria-label="Community & Pilots Pillar">
          <PillarErrorBoundary pillarName="Community">
            <CommunityPillar
              summary={summary.community}
              doc={doc}
              onSaveDoc={save}
            />
          </PillarErrorBoundary>
          <TabPagination currentId={activeTab} onNavigate={setTab} />
        </section>
      )}

      {/* VIEW 07: Housing Guidance Assistant */}
      {activeTab === 'guidance' && (
        <section id="guidance-assistant" className="min-w-0" aria-label="Housing Guidance Assistant">
          <HousingAssistant onNavigatePillar={setTab} />
          <TabPagination currentId={activeTab} onNavigate={setTab} />
        </section>
      )}

      {/* VIEW 08: Statutory Standards & Assumptions */}
      {activeTab === 'standards' && (
        <section id="statutory-standards" className="min-w-0" aria-label="Statutory Standards and Methodology">
          <DataSourcesAssumptionsPanel />
          <TabPagination currentId={activeTab} onNavigate={setTab} />
        </section>
      )}

      {/* VIEW 09: Complete Continuous Report */}
      {activeTab === 'all' && (
        <div className="space-y-12">
          <section id="hero" aria-label="Social Impact Overview Hero">
            <ImpactHeroBanner summary={summary} onSelectPillar={setTab} />
          </section>

          <section id="pillar-affordability" className="scroll-mt-28 min-w-0" aria-label="Affordability Pillar">
            <PillarErrorBoundary pillarName="Affordability">
              <AffordabilityPillar
                summary={summary.affordability}
                cost={cost}
                brief={brief}
                design={result.design}
                doc={doc}
                onSaveDoc={save}
              />
            </PillarErrorBoundary>
          </section>

          <section id="pillar-water" className="scroll-mt-28 min-w-0" aria-label="Water Security Pillar">
            <PillarErrorBoundary pillarName="Water Security">
              <WaterSecurityPillar
                summary={summary.water}
                doc={doc}
                onSaveDoc={save}
              />
            </PillarErrorBoundary>
          </section>

          <section id="pillar-climate" className="scroll-mt-28 min-w-0" aria-label="Climate & Solar Pillar">
            <PillarErrorBoundary pillarName="Climate & Solar">
              <ClimateSolarPillar
                summary={summary.climate}
                doc={doc}
                onSaveDoc={save}
              />
            </PillarErrorBoundary>
          </section>

          <section id="pillar-accessibility" className="scroll-mt-28 min-w-0" aria-label="Accessibility Pillar">
            <PillarErrorBoundary pillarName="Accessibility">
              <AccessibilityPillar
                summary={summary.accessibility}
                design={result.design}
                model={result.design.model}
                checks={data.checks}
                doc={doc}
                onSaveDoc={save}
              />
            </PillarErrorBoundary>
          </section>

          <section id="pillar-community" className="scroll-mt-28 min-w-0" aria-label="Community & Pilots Pillar">
            <PillarErrorBoundary pillarName="Community">
              <CommunityPillar
                summary={summary.community}
                doc={doc}
                onSaveDoc={save}
              />
            </PillarErrorBoundary>
          </section>

          <DataSourcesAssumptionsPanel />
        </div>
      )}

      {/* Footer & Global JSON Export/Import */}
      <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 text-xs text-ink-dim">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs text-ink uppercase tracking-wider">Official Benchmarks:</span>
          {IMPACT_SOURCES.map(source => (
            <a
              key={source.label}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-sans text-xs underline underline-offset-2 hover:text-ink text-ink-dim transition-colors"
            >
              {source.label}
              <ArrowUpRight size={11} aria-hidden />
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportJson}
            accept=".json"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={button}
            title="Import an existing impact document or legacy Formstead backup"
          >
            <Upload size={13} aria-hidden />
            <span>Import JSON</span>
          </button>

          <button
            type="button"
            onClick={() => downloadImpact(doc, data, cost, brief.project.name)}
            className={buttonPrimary}
          >
            <Download size={14} className="text-white shrink-0" aria-hidden />
            <span className="text-white font-semibold">Download Impact Record (.json)</span>
          </button>
        </div>
      </footer>
    </div>
  )
}

function TabPagination({
  currentId,
  onNavigate,
}: {
  currentId: ImpactTabId
  onNavigate: (id: ImpactTabId, options?: { scrollIntoView?: boolean }) => void
}) {
  const currentIndex = IMPACT_TABS.findIndex(t => t.id === currentId)
  if (currentIndex === -1 || currentId === 'all') return null

  const prev = currentIndex > 0 ? IMPACT_TABS[currentIndex - 1] : null
  const next = currentIndex < IMPACT_TABS.length - 1 ? IMPACT_TABS[currentIndex + 1] : null

  return (
    <nav aria-label="Functionality pagination" className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
      {prev ? (
        <button
          type="button"
          onClick={() => onNavigate(prev.id, { scrollIntoView: true })}
          className={button}
        >
          <ChevronLeft size={14} aria-hidden />
          <span>{prev.n}. {prev.label}</span>
        </button>
      ) : <div />}

      {next ? (
        <button
          type="button"
          onClick={() => onNavigate(next.id, { scrollIntoView: true })}
          className={buttonPrimary}
        >
          <span className="text-white font-semibold">{next.n}. {next.label}</span>
          <ChevronRight size={14} className="text-white shrink-0" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onNavigate('overview', { scrollIntoView: true })}
          className={buttonPrimary}
        >
          <span className="text-white font-semibold">Return to 01. Overview</span>
        </button>
      )}
    </nav>
  )
}

function HousingAssistant({
  onNavigatePillar,
}: {
  onNavigatePillar: (pillar: string, options?: { scrollIntoView?: boolean }) => void
}) {
  const [question, setQuestion] = useState('')
  const [topic, setTopic] = useState<string | null>(null)

  const responses: Record<string, string> = {
    affordability:
      'Compare measured finish lines first. Review product performance and local quotations before choosing a lower-cost option.',
    climate:
      'Review your real window paths, shading and roof specification. Temperature reductions need a weather-based thermal model.',
    water:
      'Enter rainfall, catchment area, runoff and collection efficiency to calculate collection potential. Confirm storage demand and safe overflow.',
    access:
      'Review the continuous entrance route, door clear widths, turning space and ground-floor bathroom access.',
    safety:
      'The building review shows recorded planning issues and checks that still need a qualified professional.',
    sustainability:
      'Use documented product factors and energy inputs. A partial estimate is not a whole-house carbon or energy assessment.',
    community:
      'Compare a household prototype, budget shared services separately and record anonymous pilot outcomes.',
  }

  const detected = topic ?? (question.trim() ? housingTopic(question) : null)

  return (
    <article className="rounded-xl border border-line bg-bg-raised p-6 shadow-xs mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
        <div>
          <h3 className="font-display text-xl text-ink font-normal">Housing Guidance Assistant</h3>
          <p className="font-sans text-xs sm:text-sm text-ink-dim mt-0.5">
            Ask self-build and statutory compliance questions in English, Hindi, or Marathi.
          </p>
        </div>
        <span className="rounded-full border border-line bg-bg px-3 py-1 font-mono text-xs uppercase tracking-wider text-ink-faint">
          Bilingual NLP Router
        </span>
      </div>

      <div className="mt-5 flex flex-wrap sm:flex-nowrap gap-2.5">
        <input
          type="text"
          value={question}
          onChange={e => {
            setQuestion(e.target.value)
            setTopic(null)
          }}
          placeholder="e.g. How much rainfall can I harvest? / किती पाणी साठवता येईल? / क्या रैंप जरूरी है?"
          className="min-h-11 flex-1 rounded-lg border border-line bg-bg px-4 font-sans text-sm text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-accent"
        />
        {detected && (
          <button
            type="button"
            onClick={() => {
              if (
                detected === 'water' ||
                detected === 'affordability' ||
                detected === 'climate' ||
                detected === 'access' ||
                detected === 'community'
              ) {
                onNavigatePillar(detected === 'access' ? 'accessibility' : detected, { scrollIntoView: true })
              }
            }}
            className={button}
          >
            <span>Open {detected} Module</span>
          </button>
        )}
      </div>

      {detected && responses[detected] && (
        <div className="mt-4 rounded-xl bg-bg p-4.5 text-xs font-sans text-ink border border-line shadow-2xs">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-400 capitalize mb-1.5">
            Recognized Topic: {detected}
          </p>
          <p className="font-sans text-sm leading-relaxed text-ink-dim">{responses[detected]}</p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line/60 pt-4">
        <span className="font-mono text-xs text-ink-faint mr-1">Quick Topics:</span>
        {(['affordability', 'water', 'climate', 'access', 'community'] as const).map(id => (
          <button
            key={id}
            type="button"
            className="rounded-full border border-line bg-bg px-3.5 py-1 font-mono text-xs capitalize text-ink-dim hover:bg-bg-inset hover:text-ink transition-colors cursor-pointer"
            onClick={() => setTopic(id)}
          >
            {id}
          </button>
        ))}
      </div>
    </article>
  )
}

function downloadImpact(
  doc: ImpactDocument,
  data: ReturnType<typeof analyzeImpact>,
  cost: CostEstimate,
  name: string
) {
  const record = {
    format: 'brickpilot-social-impact',
    version: 2,
    project: name,
    exportedAt: new Date().toISOString(),
    geometryKey: cost.quantities.geometryKey,
    inputs: doc,
    scores: data.scores,
    calculated: {
      conceptEstimate: cost.expected,
      costRange: cost.total,
      water: data.water,
      waterBalance: data.waterBalance,
      partialCarbon: data.carbon,
      carbonBreakdown: data.carbonBreakdown,
      roofConduction: data.heat,
      ecoSavingsRupees: data.totalEcoRupeeSavings,
      ecoSavingsCarbonKg: data.totalEcoCarbonSavingsKg,
      accessibility: data.access.verdict,
      pmay: data.pmay,
      solar: data.solar,
    },
    userReportedOutcomes: data.pilots,
    review: data.checks,
    qualifications: [
      'Concept calculations are not certified engineering results.',
      'User-reported outcomes are not independently verified.',
      'No unverified subsidy, carbon factor, household outcome or temperature improvement is assumed.',
    ],
    sources: IMPACT_SOURCES,
  }

  const url = URL.createObjectURL(
    new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' })
  )
  const a = document.createElement('a')
  a.href = url
  a.download = 'brickpilot-social-impact.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}


