import { useEffect, useMemo } from 'react'
import type { EntryRamp } from '@/lib/engine/entryRamp.ts'
import { createEntryRampGroup, disposeEntryRampGroup } from '@/lib/three/entryRamp.ts'
export function EntryRampLayer({ramp}:{ramp:EntryRamp}){
  const group=useMemo(()=>createEntryRampGroup(ramp),[ramp])
  useEffect(()=>()=>disposeEntryRampGroup(group),[group])
  return <primitive object={group} dispose={null}/>
}
