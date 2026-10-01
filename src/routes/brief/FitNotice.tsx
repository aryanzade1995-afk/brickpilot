import { useMemo } from 'react'
import { assessBriefFit } from '@/lib/engine/planner/fit.ts'
import { useStudio } from '@/state/studio.ts'

export function FitNotice() {
  const brief = useStudio((state) => state.brief)
  const fit = useMemo(() => assessBriefFit(brief), [brief])
  const good = fit.fits && fit.atTarget
  const title = fit.issues.length ? 'These requirements cannot produce a valid plan yet' :
    !fit.fits ? 'Requested rooms do not fit this plot' :
      good ? 'Required room sizes can fit this plot' : 'Minimum room sizes can fit, but space is tight'

  return (
    <div role="status" aria-live="polite" className={`border-l-2 px-4 py-3 text-sm ${fit.fits ? 'border-ok bg-ok/5' : 'border-bad bg-bad/5'}`}>
      <p className={fit.fits ? 'font-medium text-ok' : 'font-medium text-bad'}>{title}</p>
      <p className="mt-1 text-ink-dim">
        Plot: {fit.plotSqm.toFixed(0)} m². After setbacks: {fit.buildableWidthM.toFixed(1)} × {fit.buildableDepthM.toFixed(1)} m.
        {' '}{fit.busiestFloor} needs at least {fit.minimumSqm} m² of rooms and circulation; walls need additional space.
      </p>
      {fit.issues.length ? (
        <p className="mt-2 text-bad">{fit.issues.join(' ')}</p>
      ) : !fit.fits ? (
        <p className="mt-2 text-bad">Increase the plot, reduce setbacks or parking, add another floor, or request fewer rooms.</p>
      ) : (
        <p className="mt-2 text-ink-dim">The production planner has checked room minimums, doors, access and geometry.</p>
      )}
    </div>
  )
}
