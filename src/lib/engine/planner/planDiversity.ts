import type { Design } from '../types.ts'
import { planFingerprint } from './planFingerprint.ts'

export const PLAN_DIVERSITY = { grid: 16, footprintWeight: 0.65, anchorWeight: 0.25, familyWeight: 0.1 }
/** Geometry-only baseline for the ML roadmap. No learned weights or material inputs. */
export function planFeatures(design: Design): number[] {
  const { width, depth } = design.model.plot
  const cells: number[] = []
  for (let floor = 0; floor < 4; floor++) for (let y = 0; y < PLAN_DIVERSITY.grid; y++)
    for (let x = 0; x < PLAN_DIVERSITY.grid; x++) {
      const px = (x + 0.5) * width / PLAN_DIVERSITY.grid
      const py = (y + 0.5) * depth / PLAN_DIVERSITY.grid
      cells.push(design.floors[floor]?.footprint.some(r => px >= r.x && px < r.x+r.w && py >= r.y && py < r.y+r.h) ? 1 : 0)
    }
  return cells
}
export function planDistance(a: Design, b: Design): number {
  const av=planFeatures(a), bv=planFeatures(b)
  let union=0, difference=0
  for(let i=0;i<av.length;i++){if(av[i]||bv[i])union++;if(av[i]!==bv[i])difference++}
  const af=planFingerprint(a), bf=planFingerprint(b)
  const anchors=af.vector.slice(1,10).reduce((sum,n,i)=>sum+Math.abs(n-bf.vector[i+1]),0)/9
  return PLAN_DIVERSITY.footprintWeight*difference/Math.max(1,union)+
    PLAN_DIVERSITY.anchorWeight*anchors+PLAN_DIVERSITY.familyWeight*Number(a.massingType!==b.massingType)
}
export function diversePlans<T extends {plan: Design}>(pool: T[], count: number): T[] {
  if(!pool.length)return []
  const selected=[pool[0]], remaining=pool.slice(1)
  while(selected.length<count&&remaining.length){
    let best=0, score=-1
    remaining.forEach((candidate,i)=>{
      const distance=Math.min(...selected.map(other=>planDistance(candidate.plan,other.plan)))
      if(distance>score){score=distance;best=i}
    })
    selected.push(remaining.splice(best,1)[0])
  }
  return selected
}
