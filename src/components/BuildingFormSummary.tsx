import type { Design } from '@/lib/engine/types.ts'
import { plotForm, setbackTerraceArea, setbackTerraces } from '@/lib/engine/siteForm.ts'
import { rectUnionArea, rectUnionBBox } from '@/lib/geometry.ts'
import { translate as t, useLanguage } from '@/lib/i18n/index.ts'
import { modernCompositionTitle } from '@/lib/model/modernCompositions.ts'

/** These diagrams use the same occupied floor plates as the plan and GLB. */
export function BuildingFormSummary({plan}:{plan:Design}) {
  useLanguage(s=>s.language)
  if(!plan.formVersion)return null
  const kind=plotForm(plan.model)
  const box=rectUnionBBox(plan.floors.flatMap(f=>f.footprint))
  const roofArea=plan.floors.slice(1).reduce((n,f,i)=>n+Math.max(0,rectUnionArea(plan.floors[i].footprint)-rectUnionArea(f.footprint)),0)/1e6
  const terraceArea=setbackTerraceArea(plan)
  const terraces=setbackTerraces(plan)
  return <div className="mt-4 border border-line bg-bg-inset p-4" aria-label={t('Plot-responsive design')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs uppercase tracking-widest text-accent">{t('Plot-responsive design')}</p>
        <p className="mt-1 text-sm">{t(plan.model.brief.style.composition?modernCompositionTitle(plan.model.brief.style.composition):kind==='narrow'?'Narrow site · compact footprint':kind==='wide'?'Wide site · spreading wings':'Balanced site · articulated volumes')}</p>
        <p className="mt-1 text-xs text-ink-dim">{t('Road, daylight and bedroom privacy guide the layout.')}</p>
      </div>
      {terraceArea>=1?<p className="text-sm"><strong>{Math.round(terraceArea)} m²</strong> {t('of accessible setback terrace')}</p>
        :roofArea>=1&&<p className="text-sm"><strong>{Math.round(roofArea)} m²</strong> {t('of roof revealed by upper-floor setbacks')}</p>}
    </div>
    <div className="mt-3 flex flex-wrap gap-4">
      {plan.floors.map((floor,i)=><figure key={floor.level} className="w-28">
        <svg viewBox={`${box.x-600} ${box.y-600} ${box.w+1200} ${box.h+1200}`} className="h-24 w-full" role="img" aria-label={`${t(floor.name)} ${t('building footprint')}`}>
          {i>0&&plan.floors[i-1].footprint.map((r,j)=><rect key={`lower-${j}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="#d7d1c5"/>)}
          {floor.footprint.map((r,j)=><rect key={j} x={r.x} y={r.y} width={r.w} height={r.h} fill="#42665b"/>)}
          {terraces.filter(t=>t.level===floor.level).map(({room})=><rect key={room.semanticId} x={room.rect.x} y={room.rect.y} width={room.rect.w} height={room.rect.h} fill="#9ab8b0" stroke="#42665b" strokeWidth={60}/>)}
        </svg>
        <figcaption className="text-center text-xs text-ink-dim">{t(floor.name)}</figcaption>
      </figure>)}
    </div>
    <p className="mt-2 text-xs text-ink-dim">{t('Green: rooms. Blue: terrace with a door. Sand: other exposed roof.')}</p>
  </div>
}
