import { useMemo } from 'react'
import { SpecificationPanel } from '@/routes/finishes/SpecificationPanel.tsx'
import { useStudio } from '@/state/studio.ts'
import { useFinishes } from '@/state/finishes.ts'
import { estimateProjectBoq } from '@/lib/cost/index.ts'
import { geometryCostKey } from '@/lib/cost/quantities.ts'
import { specsCatalogue } from '@/lib/cost/catalogue.ts'
import type { Design } from '@/lib/engine/types.ts'

/** Reuse the actual Finishes & Cost panel, application action and estimator.
 * This component has no independent product selection or persistence model. */
export default function WalkthroughProductEditor({ design, itemId, room, onClose }: { design: Design; itemId: string; room?: string; onClose: () => void }) {
  const result = useStudio(s => s.result), edit = useStudio(s => s.edit)
  const saved = useFinishes(s => s.entries[geometryCostKey(design)])
  const cost = useMemo(() => estimateProjectBoq(design, design.model.brief, saved, result ?? undefined), [design, saved, result])
  const item = specsCatalogue.items.find(i => i.id === itemId)
  if (!item) return null
  return <SpecificationPanel item={item} brief={design.model.brief} cost={cost} design={design} solarContext={result ?? undefined} room={room} onClose={onClose} onUse={next => {
    edit(b => { b.finish = next.finish; b.specs = next.specs }); onClose()
  }} />
}
