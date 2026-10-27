import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Design } from '@/lib/engine/types.ts'
import type { BuildingModel } from '@/lib/engine/buildingModel.ts'
import type { Brief } from '@/lib/model/brief.ts'
import type { WaterConfig } from '@/lib/water/schema.ts'
import { projectPipelines } from '@/lib/water/projectPipelines.ts'
import { SIMPLE_WATER_DEFAULTS } from '@/lib/water/simpleSystem.ts'
import { subscribeDrainage, drainageRevision, forgetDrainageSnapshot } from '@/lib/utilities/sharedDrainage.ts'
import { useWaterIntelligence } from '@/state/waterIntelligence.ts'
import { useProjects } from '@/state/projects.ts'

/** Shared project scope, saved edits and tank sizes; no second routing state. */
export function useProjectPipelines(design: Design | undefined, building: BuildingModel | null | undefined,
  brief: Brief, enabled = true, draft?: WaterConfig['simple']) {
  const projectId = useProjects(s => s.currentId)
  const saved = useWaterIntelligence(s => s.document)
  const revision = useSyncExternalStore(subscribeDrainage, drainageRevision, drainageRevision)
  const [storageRevision, setStorageRevision] = useState(0)
  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if (e.key && !e.key.startsWith('formstead.drainage-inputs.v1:') && !e.key.startsWith('formstead.utility-points.v1:')) return
      forgetDrainageSnapshot(e.key); setStorageRevision(v => v + 1)
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])
  const preferences = draft ?? (saved && saved.sourcePlanId === building?.planId ? saved.simple : undefined)
  const diameter = preferences?.roofDiameterScale ?? 1, height = preferences?.roofHeightScale ?? 1
  const litres = preferences?.tankLitres ?? SIMPLE_WATER_DEFAULTS.tankLitres
  return useMemo(() => enabled && design && building ? { ...projectPipelines(design, building, brief, projectId,
    { ...SIMPLE_WATER_DEFAULTS, roofDiameterScale: diameter, roofHeightScale: height, tankLitres: litres }), drawingRevision: revision + storageRevision } : null,
  [enabled, design, building, brief, projectId, diameter, height, litres, revision, storageRevision])
}
