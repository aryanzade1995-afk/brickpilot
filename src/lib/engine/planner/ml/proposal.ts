import { z } from 'zod'
import rawModel from './data/plan-model.json' with { type: 'json' }
import type { CanonicalModel } from '../../../model/canonical.ts'
import { makeRng } from '../../massing/rng.ts'

const finite=z.number().finite()
const family=z.enum(['rectangular','stepped','l-shape','courtyard'])
const modelSchema=z.object({
  version:z.literal('resplan-ridge-retrieval-v1'), mean:z.array(finite).length(4),
  scale:z.array(finite.positive()).length(4), weights:z.array(z.array(finite).length(5)).length(5),
  trainingCount:z.number().int().positive(),
  exemplars:z.array(z.object({id:z.number().int(),features:z.array(finite).length(4),
    targets:z.array(finite).length(5),aspect:finite.positive(),family,mask:z.array(z.union([z.literal(0),z.literal(1)])).length(144)})).min(1),
})
export const parsePlanModel=(input:unknown)=>modelSchema.safeParse(input)
const parsed=parsePlanModel(rawModel)
export const learnedPlanModel=parsed.success?parsed.data:null
export type PlanProposal={version:string;exemplarId:number;family:z.infer<typeof family>;
  aspect:number;fill:number;living:[number,number];kitchen:[number,number];distance:number}
const clamp=(n:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,n))
export const PLAN_LEARNING_LIMITS={neighbors:12,regressionWeight:.25,exemplarWeight:.75,
  aspectWeight:.6,livingWeight:.25,kitchenWeight:.15,candidatePool:8} as const
/** Same encoding and units as train-plan-model.py. Ground-floor room programme only. */
export function briefFeatures(model:CanonicalModel):number[]{
  const rooms=model.floors[0].spaces.filter(r=>!r.outdoor)
  const bedrooms=rooms.filter(r=>r.role!==undefined||r.id.startsWith('bed')).length
  const baths=rooms.filter(r=>r.wet&&r.id!=='kitchen'&&r.id!=='utility').length
  return [Math.min(bedrooms,8)/8,Math.min(baths,8)/8,
    Math.min(rooms.reduce((sum,r)=>sum+r.target,0),600)/600,
    Math.log(clamp(model.envelope.width/model.envelope.depth,.25,4))/Math.log(4)]
}
/** Learned conditional prediction plus seed-controlled sampling among near neighbours.
 * Returns guidance, never unvalidated room coordinates or wall/door geometry. */
export function proposePlan(model:CanonicalModel,seed:number):PlanProposal|null{
  const trained=learnedPlanModel
  if(!trained)return null
  const features=briefFeatures(model)
  const standardized=features.map((n,i)=>(n-trained.mean[i])/trained.scale[i])
  const predicted=trained.weights[0].map((bias,j)=>clamp(bias+standardized.reduce((sum,n,i)=>sum+n*trained.weights[i+1][j],0)))
  const neighbors=trained.exemplars.map(e=>({e,distance:e.features.reduce((sum,n,i)=>
    sum+((n-features[i])/trained.scale[i])**2,0)})).sort((a,b)=>a.distance-b.distance||a.e.id-b.e.id).slice(0,PLAN_LEARNING_LIMITS.neighbors)
  const rng=makeRng(seed,`${model.seed.split('-')[0]}|learned-plan-v1`)
  const chosen=rng.weighted(neighbors.map(n=>[n,1/(1+n.distance)] as const))
  const target=predicted.map((n,i)=>clamp(n*PLAN_LEARNING_LIMITS.regressionWeight+chosen.e.targets[i]*PLAN_LEARNING_LIMITS.exemplarWeight))
  return {version:trained.version,exemplarId:chosen.e.id,family:chosen.e.family,
    aspect:chosen.e.aspect,fill:target[0],living:[target[1],target[2]],
    kitchen:[target[3],target[4]],distance:chosen.distance}
}
