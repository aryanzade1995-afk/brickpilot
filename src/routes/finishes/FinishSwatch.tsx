import type { SpecItem, SpecOption } from '@/lib/cost/workspace.ts'
import { finishPreview } from '@/lib/finishes/preview.ts'
import { flooringProduct } from '@/lib/flooring/catalogue.ts'
import { finishProduct } from '@/lib/finishes/catalogue.ts'
import { SpecificationImage } from '@/components/SpecificationImage.tsx'
/** Labelled illustrations are not supplier product photographs. */
export function FinishSwatch({item,option,className=''}:{item:SpecItem;option:SpecOption;className?:string}) {
 const preview=finishPreview(item,option),floor=flooringProduct(option.flooringProductId),finish=finishProduct(option.finishProductId)
 const realImage=!!floor?.thumbnail||!!finish?.image.path
 if(realImage)return <SpecificationImage option={option} className={className}/>
 if(preview.texture)return <img src={preview.texture} alt={`${option.name}: representative real texture close-up`} className={className}/>
 return <div className={`relative flex items-center justify-center overflow-hidden rounded-lg bg-bg-inset ${className}`} title="Indicative finish illustration · product photo unavailable">
  <svg viewBox="0 0 120 95" role="img" aria-label={`${preview.kind} finish illustration, not a product photograph`} className="h-full max-h-24 w-full p-3">
   {preview.kind==='window'?<><rect x="27" y="7" width="66" height="74" rx="1" fill={preview.color} stroke="#777"/><rect x="32" y="12" width="25" height="64" fill="#a9c5ce"/><rect x="63" y="12" width="25" height="64" fill="#a9c5ce"/></>:
    preview.kind==='door'?<><rect x="32" y="8" width="56" height="74" fill={preview.color} stroke="#777"/><path d="M78 40v12" stroke="#777" strokeWidth="3"/></>:
    preview.kind==='gate'||preview.kind==='railing'?<><path d="M10 25h100M10 70h100" stroke={preview.color} strokeWidth="6"/>{[15,30,45,60,75,90,105].map(x=><path key={x} d={`M${x} 25v45`} stroke="#777" strokeWidth="3"/>)}</>:
    preview.kind==='kitchen'?<><rect x="10" y="45" width="100" height="35" fill={preview.color} stroke="#777"/><path d="M10 45h100M43 46v34M77 46v34" stroke="#777" strokeWidth="3"/></>:
    <rect x="14" y="15" width="92" height="62" fill={preview.color} stroke="#aaa"/>}
  </svg><span className="absolute inset-x-0 bottom-0 bg-bg/85 text-center text-[9px] text-ink-dim">Finish illustration</span>
 </div>
}
