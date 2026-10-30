import {translate as t,useLanguage} from '@/lib/i18n/index.ts'
import type {Brief} from '@/lib/model/brief.ts'
import {interiorAsset,automaticInteriorModel,MODEL_CATEGORIES,selectedInteriorModel,setInteriorModel} from '@/lib/interior-assets/catalogue.ts'
import {resolveSpecification,specsCatalogue} from '@/lib/cost/catalogue.ts'
import {sanitaryKind} from '@/lib/interior/finishes.ts'

export default function InteriorModels({brief,room,onBrief}:{brief:Brief;room?:string;onBrief:(b:Brief)=>void}){
 useLanguage(s=>s.language)
 const slab=resolveSpecification(brief,'kitchen-counter'),slabGroup=specsCatalogue.items.find(i=>i.id==='kitchen-counter')!.group
 return <div className="mt-4">
  <p className="max-w-2xl text-sm leading-relaxed text-ink-dim">{t('Real furniture and fixture models, fitted to your existing room layout.')}</p>
  <p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-faint">{t('Model style changes the walkthrough appearance. Products, quantities and prices stay linked to your existing specifications. Models are generic visual references, not exact manufacturer replicas.')}</p>
  <a href="/workspace/interior#whole-house-walkthrough" className="mt-4 inline-flex min-h-11 items-center border border-line px-4 text-xs">{t('View in walkthrough')} →</a>
  <article className="mt-5 rounded-xl border border-line bg-bg-inset p-5"><h3 className="font-display text-xl">{t('Your Blender kitchen pack')}</h3><p className="mt-2 text-sm text-ink-dim">Kitchen Cabinet Library · Kitchen cabinet · Kitchen interior design</p><p className="mt-2 text-xs text-ink-dim">{t('Use the same fitted cabinets, wall units and hob in the walkthrough, furnished view and ventilation view. Countertops and product costs follow your selected specifications.')}</p><button type="button" className="mt-4 min-h-11 border border-line bg-bg px-4 text-xs" onClick={()=>{let next=brief;for(const [category,id] of [['kitchen-base','user-library-base'],['kitchen-upper','user-kitchen-upper'],['kitchen-hob','user-kitchen-hob'],['lamp','user-kitchen-pendant']] as const)next=setInteriorModel(next,category,id,room);onBrief(next)}}>{t('Use kitchen pack')}</button></article>
  <article className="mt-5 rounded-xl border border-line bg-bg-inset p-5"><h3 className="font-display text-xl">{t('Kitchen slabs')}</h3><p className="mt-2 text-sm">{t(slab.name)}</p><p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-dim">{t('Continuous worktops with finished edges and sink cut-outs. Stone, colour and cost follow your kitchen countertop specification.')}</p><a className="mt-3 inline-flex min-h-11 items-center border border-line bg-bg px-4 text-xs" href={`/workspace/finishes?tab=specifications&section=${slabGroup}`}>{t('Choose countertop finish')} →</a></article>
  <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{MODEL_CATEGORIES.map(c=>{
   const item=specsCatalogue.items.find(i=>i.id===c.item),option=item?resolveSpecification(brief,item.id,room):null
   const selected=selectedInteriorModel(brief,c.id,room),wc=c.id==='toilet'&&option?sanitaryKind(option.name,option.id):null
   const preview=c.id==='toilet'&&wc==='wall'?'toilet-wall':selected==='auto'||selected==='procedural'?automaticInteriorModel(c.id):selected
   const asset=wc==='indian'?null:interiorAsset(preview)
   return <article key={c.id} className="overflow-hidden rounded-xl border border-line bg-bg">
    {asset&&<img src={asset.thumbnail} alt={t(c.label)} loading="lazy" className="aspect-[4/3] w-full bg-bg-inset object-contain"/>}
    <div className="p-4"><h3 className="font-display text-lg">{t(c.label)}</h3>
     <p className="mt-1 text-xs text-ink-dim">{t(c.rooms)}</p>
     {option&&<p className="mt-3 text-xs leading-relaxed"><span className="text-ink-faint">{t('Selected specification')}: </span>{t(option.name)}</p>}
     <label className="mt-4 block text-xs">{t('3D model style')}<select aria-label={`${t(c.label)} · ${t('3D model style')}`} value={selected} onChange={e=>onBrief(setInteriorModel(brief,c.id,e.target.value,room))} className="mt-2 min-h-11 w-full border border-line bg-bg px-3 text-sm">
      <option value="auto">{t('Realistic · automatic')}</option>
      {c.assets.filter(id=>interiorAsset(id)).map(id=><option key={id} value={id}>{t(interiorAsset(id)!.label)}</option>)}
      <option value="procedural">{t('Standard model')}</option>
     </select></label>
     {c.id==='toilet'&&<p className="mt-2 text-xs leading-relaxed text-ink-faint">{t('WC type follows your sanitary selection. Indian pans retain their matching standard model.')}</p>}
     {asset&&<details className="mt-3 border-t border-line text-xs text-ink-faint"><summary className="min-h-11 cursor-pointer py-3">{t('Model credits')}</summary><p>{asset.author} · <a className="underline" href={asset.licenseUrl} target="_blank" rel="noreferrer">{asset.license}</a></p><p className="mt-2">{t('Optimized for the browser; scale and colours may be adapted.')}</p><a href={asset.notice} target="_blank" rel="noreferrer" className="my-2 inline-flex min-h-11 items-center underline">{t('Source & licence')}</a></details>}
    </div>
   </article>
  })}</div>
  <p className="mt-5 text-xs leading-relaxed text-ink-dim">{t('Only items already placed in a room are replaced. Other selected lights, switches, taps, showers and fitted products keep their existing matching representations. Missing downloads keep the standard model.')}</p>
 </div>
}
