import type { CanonicalModel } from '../../model/canonical.ts'
import { makeRng } from '../massing/rng.ts'

export type LayoutChoices = {
 living: 'front'|'back'|'side'
 stair: 'front'|'centre'|'side'
 master: 'ground'|'upper'
 kitchen: 'garden'|'service'
 verandah: 'none'|'front'|'wrap'
 doubleHeight: boolean
 centralBay?: boolean
}

/** Independent stream: pinning a resolved family must replay the same choices. */
export function layoutChoices(model: CanonicalModel, seed: number, sideWing: boolean): LayoutChoices {
 const composition=model.brief.style.character==='modern-box'?model.brief.style.composition:undefined
 if(composition)return {living:'front',stair:composition==='glazed-bay'?'front':'side',centralBay:composition==='glazed-bay',master:'upper',
  kitchen:'service',verandah:'none',doubleHeight:composition==='glazed-bay'&&model.floors.length===2}
 if(model.envelope.width*model.envelope.depth<600e6)return {living:'front',stair:'side',master:'upper',
  kitchen:'garden',verandah:'none',doubleHeight:false}
 const rng=makeRng(seed,`${model.seed.split('-')[0]}|layout-choices`)
 return {living:rng.pick(sideWing?['front','back','side']:['front','back']),
  stair:rng.pick(['front','centre','side']),master:model.floors.length>1?rng.pick(['ground','upper']):'ground',
  kitchen:rng.pick(['garden','service']),
  verandah:'none',
  doubleHeight:model.floors.length>1&&rng.chance(.35)}
}

/** A seeded programme alternative, before coordinates. Preserve requested rooms,
 * senior ground-floor accommodation and every bedroom/ensuite group. */
export function layoutProgramme(source: CanonicalModel, choices: LayoutChoices): CanonicalModel {
 const model=structuredClone(source),ground=model.floors[0]
 // Old pinned recipes may still request a wrap verandah. Retire that outdoor programme too.
 ground.spaces=ground.spaces.filter(s=>s.id!=='verandah'&&!s.id.startsWith('verandahWing'))
 model.relationships=model.relationships.filter(r=>![r.a,r.b].some(id=>id==='verandah'||id.startsWith('verandahWing')))
 if(choices.master==='ground'){
  const upper=model.floors.slice(1).find(f=>f.spaces.some(s=>s.role==='master'))
  if(upper){
   const owners=upper.spaces.filter(s=>s.role==='master'||s.role==='child')
   const ids=new Set(owners.map(s=>s.id))
   for(const owner of owners)for(const relation of model.relationships.filter(r=>r.kind==='adjacent'&&r.a===owner.id))
    if(upper.spaces.some(s=>s.id===relation.b&&s.wet))ids.add(relation.b)
   const moved=upper.spaces.filter(s=>ids.has(s.id))
   upper.spaces=upper.spaces.filter(s=>!ids.has(s.id));ground.spaces.push(...moved)
   for(const owner of owners)model.relationships.push({a:'foyer',b:owner.id,kind:'connected'})
  }
 }
 return model
}
