import {useState} from 'react'
import {Link} from 'react-router-dom'
import {Shuffle} from 'lucide-react'
import {FACADE_DESIGNS,type FacadeDesign} from '@/lib/model/facadeDesign.ts'
import type {FacadeVariation} from '@/lib/engine/facade/variations.ts'
import {newDesignSeed} from '@/lib/newDesignSeed.ts'

export function FacadeDesignControls({value,model,onChange,onRender,busy,rendered}:{value:FacadeDesign;model:FacadeVariation|null;onChange:(v:FacadeDesign)=>void;onRender:()=>void;busy:boolean;rendered:boolean}){
 const [seed,setSeed]=useState<string|null>(null)
 const update=(patch:Partial<FacadeDesign>)=>onChange({...value,...patch,facadeStyle:'MIXED'})
 const field='min-h-11 w-full border border-line bg-bg px-3 text-sm'
 return <div className="mt-4 border border-line bg-bg p-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h3 className="text-sm font-medium">Facade mix</h3><p className="mt-1 text-xs text-ink-dim">{model?.styles?.length??0} designs combined automatically · Saved with your house</p></div>
   <button type="button" onClick={()=>update({facadeSeed:newDesignSeed(value.facadeSeed)})} className="inline-flex min-h-11 items-center gap-2 border border-line px-4 text-sm hover:bg-bg-inset"><Shuffle size={15} aria-hidden="true"/>Shuffle facade</button>
  </div>
  <ul aria-label="Combined facade designs" className="mt-3 flex flex-wrap gap-2">
   {model?.styles?.map(id=><li key={id} className="border border-line bg-bg-inset px-2 py-1 text-[11px] text-ink-dim">{FACADE_DESIGNS.find(d=>d[0]===id)?.[1]}</li>)}
  </ul>
  <details className="mt-3 border-t border-line pt-3">
   <summary className="cursor-pointer text-xs text-ink-dim">Materials & saved seed</summary>
   <div className="mt-3 grid items-end gap-3 sm:grid-cols-3">
    <label className="text-xs">Custom seed<input className={`mt-1 ${field}`} type="number" min={0} max={4294967295} value={seed??String(value.facadeSeed)} onChange={e=>setSeed(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} onBlur={()=>{const n=Number(seed??value.facadeSeed);if(Number.isInteger(n)&&n>=0&&n<=4294967295)update({facadeSeed:n});setSeed(null)}}/></label>
    <label className="text-xs">Facade materials<select className={`mt-1 ${field}`} value={value.materialPalette} onChange={e=>update({materialPalette:e.target.value as FacadeDesign['materialPalette']})}><option value="selected">Selected exterior finish</option><option value="warm-timber">Warm timber</option><option value="stone-metal">Stone & metal</option><option value="light-mineral">Light mineral</option></select></label>
    <label className="text-xs">Detail intensity · {Math.round(value.facadeVariation*100)}%<input aria-label="Facade detail intensity" className="mt-4 block w-full accent-stone-700" type="range" min={0} max={1} step={.05} value={value.facadeVariation} onChange={e=>update({facadeVariation:Number(e.target.value)})}/></label>
   </div>
  </details>
  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><button type="button" disabled={busy||!model?.parts.length} onClick={onRender} className="min-h-11 border border-line px-4 disabled:opacity-50">{busy?'Rendering…':rendered?'Export current facade':'Render facade & downloads'}</button><Link className="text-ink-dim underline" to="/workspace/finishes?tab=specifications">Exterior finishes</Link></div>
  {!rendered&&<p className="mt-2 text-xs text-ink-dim">Live mix shown. Render to update Blender views and downloads.</p>}
 </div>
}
