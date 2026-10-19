import { rectUnionArea } from '../geometry.ts'
import { planToCompass, type CanonicalModel } from '../model/canonical.ts'
import type { Design } from './types.ts'
import type { PlateFamily } from './planner/types.ts'
import { makeRng } from './massing/rng.ts'
import { windowFacings } from './orientation.ts'

/** Opt-in and persisted: older saved plans keep their original coordinates. */
export const SITE_FORM_VERSION = 'site-form-v3' as const
export type FormVersion = 'site-form-v1' | 'site-form-v2' | typeof SITE_FORM_VERSION
export const parseFormVersion = (value: unknown): FormVersion | undefined =>
  value === 'site-form-v1' || value === 'site-form-v2' || value === SITE_FORM_VERSION ? value : undefined
export const usesSetbackTerraces=(version:FormVersion|undefined)=>version==='site-form-v2'||version===SITE_FORM_VERSION
export type UpperProfile = 'compact' | 'terraced' | 'staggered' | 'recessed'
export type PlotForm = 'narrow' | 'wide' | 'balanced'

export function plotForm(model: CanonicalModel): PlotForm {
  const { width, depth } = model.envelope
  return width < 10500 || width / depth < .62 ? 'narrow' : width / depth > 1.35 ? 'wide' : 'balanced'
}

export function upperProfile(model: CanonicalModel, seed: number): UpperProfile {
  if (plotForm(model) === 'narrow') return 'compact'
  const composition=model.brief.style.character==='modern-box'?model.brief.style.composition:undefined
  if(composition)return composition==='glazed-bay'?'recessed':composition==='staggered-wings'?'staggered':'terraced'
  return makeRng(seed, 'site-form-upper-v1').pick(['terraced', 'staggered', 'recessed'] as UpperProfile[])
}

/** Composition chooses a planning grammar before any room coordinates exist. */
export function compositionFamilies(model:CanonicalModel):PlateFamily[]|null {
  const composition=model.brief.style.composition
  if(!composition||model.brief.style.character!=='modern-box')return null
  if(model.brief.rooms.priorities.courtyard)return ['courtyard-ring','courtyard']
  return composition==='glazed-bay'?['u-wing','twin-wing','stepped']:
    composition==='staggered-wings'?['pavilion','twin-wing','u-wing','l-shape']:['stepped','l-shape','u-wing']
}

/** In the compiled model, width is across the entrance, even on E/W roads. */
export function siteFamilyOrder(model: CanonicalModel, families: PlateFamily[]): PlateFamily[] {
  const kind = plotForm(model)
  const order: PlateFamily[] = kind === 'narrow' ? ['stepped', 'rectangular', 'l-shape', 'courtyard']
    : kind === 'wide' ? ['l-shape', 'stepped', 'twin-wing', 'u-wing', 'pavilion', 'courtyard-ring', 'courtyard', 'rectangular']
    : ['u-wing', 'pavilion', 'twin-wing', 'stepped', 'l-shape', 'courtyard-ring', 'courtyard', 'rectangular']
  return [...families].sort((a, b) => {
    const rank = (f: PlateFamily) => { const i = order.indexOf(f); return i < 0 ? 100 : i }
    return rank(a) - rank(b)
  })
}

/** Soft ranking of already valid source geometry. No room or window is moved
 * after validation; privacy/daylight can only select a different valid plan. */
export function siteFormScore(design: Design): number {
  const model = design.model, box = design.floors[0].outline
  const desired = Math.max(.4, Math.min(2.5, model.envelope.width / model.envelope.depth))
  let score = -3 * Math.abs(Math.log((box.w / box.h) / desired))
  const preferred=compositionFamilies(model)
  if(preferred&&preferred.includes(design.massingType as PlateFamily))score+=(preferred.length-preferred.indexOf(design.massingType as PlateFamily))*12
  const roads = model.brief.site.roadEdges
  const entry = design.floors[0].openings.find(o => o.kind === 'entry')
  const diagonal = Math.hypot(box.w, box.h)
  for (const floor of design.floors) for (const room of floor.rooms) {
    if (room.outdoor || !room.wantsWindow) continue
    const sides = windowFacings(design, room.id, floor.level)
    if (sides.includes('N') || sides.includes('E')) score += .35
    if (sides.length && sides.every(s => s === 'W')) score -= .6
    if (room.zone === 'private') {
      // Ground bedrooms overlooking any road are less private; upper rooms
      // receive a smaller penalty, without pretending to simulate neighbours.
      const streetWindows = floor.openings.filter(o => o.kind==='window' && o.rooms?.includes(room.id)).filter(o => {
        const b=floor.outline
        const side=o.orient==='h' ? Math.abs(o.at.y-b.y)<2?'N':Math.abs(o.at.y-b.y-b.h)<2?'S':null
          : Math.abs(o.at.x-b.x)<2?'W':Math.abs(o.at.x-b.x-b.w)<2?'E':null
        return side && roads.includes(planToCompass[model.entrySide][side])
      }).length
      score -= streetWindows * (floor.level === 0 ? .85 : .3)
      if (entry) score += .8 * Math.min(1, Math.hypot(room.rect.x + room.rect.w / 2 - entry.at.x,
        room.rect.y + room.rect.h / 2 - entry.at.y) / diagonal)
    }
  }
  if (plotForm(model) !== 'narrow' && design.floors.length > 1) {
    const a = rectUnionArea(design.floors[0].footprint), b = rectUnionArea(design.floors[1].footprint)
    score += Math.min(.8, Math.max(0, 1 - b / a) * 2)
    if(usesSetbackTerraces(design.formVersion))score+=Math.min(2,setbackTerraceArea(design)/8)
  }
  return score
}

/** Count only door-connected outdoor rooms fully carried by the lower roof. */
export function setbackTerraces(design:Design) {
  return design.floors.slice(1).flatMap((floor,index)=>floor.rooms.filter(room=>{
    if(!room.outdoor||!room.id.startsWith('balcony'))return false
    if(!floor.openings.some(o=>o.kind==='door'&&o.rooms?.includes(room.id)))return false
    const overlap=design.floors[index].footprint.map(p=>{
      const x=Math.max(room.rect.x,p.x),y=Math.max(room.rect.y,p.y)
      return {x,y,w:Math.max(0,Math.min(room.rect.x+room.rect.w,p.x+p.w)-x),h:Math.max(0,Math.min(room.rect.y+room.rect.h,p.y+p.h)-y)}
    }).filter(r=>r.w>0&&r.h>0)
    return rectUnionArea(overlap)>=room.rect.w*room.rect.h-1000
  }).map(room=>({level:floor.level,room})))
}

export const setbackTerraceArea=(design:Design):number=>setbackTerraces(design)
  .reduce((n,{room})=>n+room.rect.w*room.rect.h/1e6,0)
