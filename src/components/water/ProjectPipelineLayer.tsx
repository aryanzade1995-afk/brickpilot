import { Suspense, useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import type { Group, Plane } from 'three'
import type { ProjectPipelines } from '@/lib/water/projectPipelines.ts'
import { stylePipelineOverlay } from '@/lib/three/pipelineVisibility.ts'
import { SimpleWaterLayer } from './SimpleWaterLayer.tsx'
import { ProjectDrainageLayer } from './ProjectDrainageLayer.tsx'

/** Sibling to architecture and physics, not part of the accepted model cache.
 * Static by default: pipe edits never regenerate the villa or walking scene. */
export function ProjectPipelineLayer(props: { network: ProjectPipelines; water: boolean; drain: boolean; xray: boolean; plane?: Plane | null }) {
  return <Suspense fallback={null}><PipelineContents {...props}/></Suspense>
}
function PipelineContents({ network, water, drain, xray, plane = null }: {
  network: ProjectPipelines; water: boolean; drain: boolean; xray: boolean; plane?: Plane | null
}) {
  const root = useRef<Group>(null), invalidate = useThree(s => s.invalidate)
  const [selected, setSelected] = useState('')
  useEffect(() => {
    if (root.current) stylePipelineOverlay(root.current, xray, plane)
    invalidate()
  }, [network, water, drain, xray, plane, selected, invalidate])
  const { home, rain, supply } = network
  return <group ref={root} name="Formstead_Current_Project_Pipelines" userData={{ formstead_plumbing: true, source_plan_id: network.planId }}>
    {water && <SimpleWaterLayer home={home} rain={rain} mode="home" xray={xray} animate={false} labels={false} selected={selected} onSelect={setSelected} supplyNetwork={supply}/>}
    {drain && <ProjectDrainageLayer network={network} xray={xray}/>}
  </group>
}
