import type { FC } from 'react'
import { TrendingDown, Droplets, SunMedium, Accessibility } from 'lucide-react'
import type { ImpactSummary } from '@/lib/impact/summary.ts'
import { SvgHouseCrossSection } from './charts/SvgHouseCrossSection.tsx'
import { SvgImpactScoreRing } from './charts/SvgImpactScoreRing.tsx'
import { SvgMiniSparkline } from './charts/SvgMiniSparkline.tsx'

export interface ImpactHeroBannerProps {
  summary: ImpactSummary
  onSelectPillar: (pillarId: string) => void
  className?: string
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

export const ImpactHeroBanner: FC<ImpactHeroBannerProps> = ({
  summary,
  onSelectPillar,
  className = '',
}) => {
  const { kpis, scores, headline, water, climate, accessibility } = summary

  return (
    <div className={`flex flex-col gap-6 ${className}`}>
      {/* Signature Cross-Section & Impact Score Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-8 flex flex-col justify-between">
          <SvgHouseCrossSection
            roofAreaM2={climate.roofAreaM2}
            solarKw={climate.solar.solarCapacityKw}
            annualHarvestL={water.annualHarvestL}
            annualHarvestCoverageDays={water.annualHarvestCoverageDays}
            tankAutonomyDisplay={water.tankAutonomyDisplay}
            heatCutWatts={climate.heatCutWatts}
            hasCoolRoof={climate.coolRoofU < 1.0}
            hasRamp={accessibility.ramp.status === 'pass'}
            rampRatio={accessibility.ramp.gradientRatio ?? 12}
            ventilationPathsCount={climate.ventilationRoutesCount}
          />
        </div>
        <div className="lg:col-span-4 flex flex-col justify-between gap-4">
          <SvgImpactScoreRing scores={scores} />
          {/* Live Headline Banner */}
          <div className="rounded-xl border border-line bg-bg-raised p-5 shadow-2xs">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-emerald-800">
              Key Metric Finding
            </span>
            <p className="mt-1.5 font-display text-base font-medium text-ink leading-snug">
              {headline}
            </p>
          </div>
        </div>
      </div>

      {/* 4 Interactive Hero KPI Tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Tile 1: BOQ Eco-Savings */}
        <button
          type="button"
          onClick={() => onSelectPillar('affordability')}
          className="group flex flex-col justify-between rounded-xl border border-line bg-bg-raised p-5 text-left transition-all hover:border-accent hover:shadow-xs focus-visible:outline-2 focus-visible:outline-accent shadow-2xs cursor-pointer min-h-[140px]"
        >
          <div className="flex items-center justify-between text-xs text-ink-dim w-full">
            <span className="font-mono uppercase tracking-wider text-xs">Pillar 01 · Cost</span>
            <div className="flex items-center gap-1.5">
              <SvgMiniSparkline data={kpis.affordability.sparklineData} color="#059669" />
              <TrendingDown size={15} className="text-emerald-700 group-hover:translate-y-0.5 transition-transform" aria-hidden />
            </div>
          </div>
          <div>
            <p className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink">
              {fmt(kpis.affordability.ecoSavingsInr)}
            </p>
            <p className="mt-1.5 font-mono text-xs text-emerald-800 font-semibold">
              -{kpis.affordability.ecoSavingsPct.toFixed(1)}% with 1-Click Swaps
            </p>
          </div>
        </button>

        {/* Tile 2: Water Coverage & Drought Autonomy */}
        <button
          type="button"
          onClick={() => onSelectPillar('water')}
          className="group flex flex-col justify-between rounded-xl border border-line bg-bg-raised p-5 text-left transition-all hover:border-accent hover:shadow-xs focus-visible:outline-2 focus-visible:outline-accent shadow-2xs cursor-pointer min-h-[140px]"
        >
          <div className="flex items-center justify-between text-xs text-ink-dim w-full">
            <span className="font-mono uppercase tracking-wider text-xs">Pillar 02 · Water</span>
            <div className="flex items-center gap-1.5">
              <SvgMiniSparkline data={kpis.water.sparklineData} color="#0284c7" />
              <Droplets size={15} className="text-sky-700 group-hover:scale-110 transition-transform" aria-hidden />
            </div>
          </div>
          <div>
            <p className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink">
              {kpis.water.annualHarvestCoverageDays} Days
            </p>
            <div className="mt-1.5 font-mono text-xs text-ink-dim flex flex-col gap-0.5">
              <span className="text-sky-800 font-semibold">
                Usable: {kpis.water.usableHarvestL.toLocaleString('en-IN')} L ({kpis.water.demandCoveredPercent}%)
              </span>
              <span className="text-ink-faint font-sans">
                Full tank lasts {kpis.water.tankAutonomyDisplay} without rain
              </span>
            </div>
          </div>
        </button>

        {/* Tile 3: Heat Ingress Avoided */}
        <button
          type="button"
          onClick={() => onSelectPillar('climate')}
          className="group flex flex-col justify-between rounded-xl border border-line bg-bg-raised p-5 text-left transition-all hover:border-accent hover:shadow-xs focus-visible:outline-2 focus-visible:outline-accent shadow-2xs cursor-pointer min-h-[140px]"
        >
          <div className="flex items-center justify-between text-xs text-ink-dim w-full">
            <span className="font-mono uppercase tracking-wider text-xs">Pillar 03 · Climate</span>
            <div className="flex items-center gap-1.5">
              <SvgMiniSparkline data={kpis.climate.sparklineData} color="#d97706" />
              <SunMedium size={15} className="text-amber-700 group-hover:rotate-45 transition-transform" aria-hidden />
            </div>
          </div>
          <div>
            <p className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink">
              {kpis.climate.heatCutWatts.toLocaleString('en-IN')} W
            </p>
            <p className="mt-1.5 font-mono text-xs text-amber-800 font-semibold">
              Cool Roof Ingress Cut (W = U × A × ΔT)
            </p>
          </div>
        </button>

        {/* Tile 4: Accessibility Status */}
        <button
          type="button"
          onClick={() => onSelectPillar('accessibility')}
          className="group flex flex-col justify-between rounded-xl border border-line bg-bg-raised p-5 text-left transition-all hover:border-accent hover:shadow-xs focus-visible:outline-2 focus-visible:outline-accent shadow-2xs cursor-pointer min-h-[140px]"
        >
          <div className="flex items-center justify-between text-xs text-ink-dim w-full">
            <span className="font-mono uppercase tracking-wider text-xs">Pillar 04 · Access</span>
            <Accessibility size={15} className="text-ink group-hover:scale-110 transition-transform" aria-hidden />
          </div>
          <div>
            <p
              className={`mt-3 font-display text-3xl font-semibold tracking-tight ${
                kpis.accessibility.verdict === 'Pass'
                  ? 'text-emerald-800'
                  : kpis.accessibility.verdict === 'Partial'
                  ? 'text-amber-800'
                  : 'text-rose-800'
              }`}
            >
              DEPwD {kpis.accessibility.verdict}
            </p>
            <p className="mt-1.5 font-mono text-xs text-ink-dim truncate" title={kpis.accessibility.detail}>
              {kpis.accessibility.routeDoorsPassCount}/{kpis.accessibility.routeDoorsTotalCount} route doors ≥900mm
            </p>
          </div>
        </button>
      </div>
    </div>
  )
}
