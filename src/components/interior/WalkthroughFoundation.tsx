import { useMemo } from 'react'
import type { Design } from '@/lib/engine/types.ts'
import type { BuildingModel } from '@/lib/engine/buildingModel.ts'
import type { ValidationReport } from '@/lib/rules/index.ts'
import { createWalkthroughSource, assessWalkthroughAsset, type WalkthroughPreferences, type WalkthroughIssueCode } from '@/lib/walkthrough/source.ts'
import { useInterior360 } from '@/state/interior360.ts'
import { useBlender } from '@/state/blender.ts'
import { translate as t, useLanguage } from '@/lib/i18n/index.ts'
import { AcceptedVillaWalkthrough } from './AcceptedVillaWalkthrough.tsx'

const issueLabels: Record<WalkthroughIssueCode, string> = {
  INVALID_PLAN: 'The source plan needs validation.',
  ACCEPTED_MODEL_MISMATCH: 'The accepted building and current plan need to be reconciled.',
  DOOR_HOST_UNRESOLVED: 'Some door openings need a confirmed wall connection.',
  DOOR_CONNECTION_UNRESOLVED: 'Some door openings need confirmed room connections.',
  ENTRY_CONNECTION_UNRESOLVED: 'The main entrance connection needs checking.',
  SPACE_CONNECTION_UNCONFIRMED: 'Some spaces do not yet have a confirmed connection from the entrance.',
  STAIR_SOURCE_UNSUPPORTED: 'Some stair records need more source information.',
  STAIR_SOURCE_MISSING: 'A connection between floors is missing its source stair.',
}

/** Explicit geometry/export preparation. Existing panorama state stays separate. */
export function WalkthroughFoundation({ design, report, acceptedBuilding }: {
  design: Design; report: ValidationReport; acceptedBuilding: BuildingModel | null
}) {
  useLanguage(s => s.language)
  const style = useInterior360(s => s.style), lighting = useInterior360(s => s.lighting), furnitureDensity = useInterior360(s => s.furnitureDensity)
  const prepared = useMemo(() => {
    try { return { source: createWalkthroughSource(design, report, { style, lighting, furnitureDensity } as WalkthroughPreferences, acceptedBuilding) } }
    catch { return { source: null } }
  }, [design, report, style, lighting, furnitureDensity, acceptedBuilding])
  const source = prepared.source
  const asset = useBlender(s => source ? s.accepted[source.building.planId] : undefined)
  const assetState = source ? assessWalkthroughAsset(source, design, asset) : 'missing'
  const groups = source ? [...new Set(source.issues.map(i => i.code))].map(code => ({ code, count: source.issues.filter(i => i.code === code).length })) : []
  return <section id="whole-house-walkthrough" aria-labelledby="walkthrough-title" data-walkthrough-phase="walking" className="mt-10 border border-line bg-bg">
    <div className="border-b border-line p-5 md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div>
        <p className="label">{t('Whole-house experience')}</p>
        <h2 id="walkthrough-title" className="mt-2 font-display text-2xl md:text-3xl">{t('3D house walkthrough')}</h2>
      </div><span className="border border-line bg-bg-inset px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-dim">{t('First-person walkthrough')}</span></div>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-dim">{t('Explore the exact accepted villa from 3D Massing. Its original Blender geometry and materials stay unchanged.')}</p>
    </div>
    {!source ? <p role="status" className="p-5 text-sm text-ink-dim">{t('The walkthrough source could not be prepared. Your existing previews are still available.')}</p> : <>
      <dl className="grid grid-cols-2 gap-px border-b border-line bg-line md:grid-cols-4">{[
        ['Source floors', source.building.floors.length], ['Indoor spaces', source.rooms.filter(r => !r.outdoor).length],
        ['Source doors', source.building.doors.length], ['Source windows', source.building.windows.length],
      ].map(([label, count]) => <div key={label} className="bg-bg p-5"><dt className="text-xs text-ink-dim">{t(label)}</dt><dd className="mt-2 font-display text-2xl">{count}</dd></div>)}</dl>
      <div className="grid gap-6 p-5 md:grid-cols-2 md:p-7">
        <div><h3 className="font-display text-lg">{t('What is connected to this foundation')}</h3><ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-dim">
          <li>{t('Recorded walls, rooms, door openings and windows from the current plan.')}</li>
          <li>{t('The same accepted Blender file used in 3D Massing.')}</li>
          <li>{t('Floor heights, courtyard and double-height void records are preserved.')}</li>
        </ul></div>
        <div><h3 className="font-display text-lg">{t('Explore the house')}</h3><ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-dim">
          <li>{t('Open the villa walkthrough, then choose Walk inside.')}</li>
          <li>{t('Use WASD to move and the mouse to look. Closed doors stay as exported.')}</li>
          <li>{t('Press Escape to release the mouse and return to the normal 3D view.')}</li>
        </ul></div>
      </div>
      <AcceptedVillaWalkthrough key={source.building.planId} asset={asset} source={source} finishesCurrent={assetState === 'candidate-needs-interior-audit'} />
      {groups.length > 0 && <details className="border-t border-line px-5 py-2 md:px-7"><summary className="min-h-11 cursor-pointer py-3 text-sm">{t('Source items to review')} ({source.issues.length})</summary>
        <ul className="mb-4 space-y-2 text-xs leading-relaxed text-ink-dim">{groups.map(g => <li key={g.code}>{t(issueLabels[g.code])} <span className="font-mono">({g.count})</span></li>)}</ul>
      </details>}
    </>}
  </section>
}
