import type { SpecItem, SpecOption } from '@/lib/cost/workspace.ts'
import { finishPreview } from '@/lib/finishes/preview.ts'
import { optionImage } from '@/lib/finishes/optionImage.ts'
import { SpecificationImage } from '@/components/SpecificationImage.tsx'
/** Labelled illustrations are not supplier product photographs. */
export function FinishSwatch({item,option,className=''}:{item:SpecItem;option:SpecOption;className?:string}) {
 const preview=finishPreview(item,option)
 const realImage=!!optionImage(option)
 if(realImage)return <SpecificationImage option={option} className={className}/>
 if(preview.texture&&!['ceiling','landscape','pool','roof','sanitary','fittings'].includes(preview.kind))return <img src={preview.texture} alt={`${option.name}: representative real texture close-up`} className={className}/>
 return <div className={`relative flex items-center justify-center overflow-hidden rounded-lg bg-bg-inset ${className}`} title="Indicative finish illustration · product photo unavailable">
  <svg viewBox="0 0 120 95" role="img" aria-label={`${preview.kind} finish illustration, not a product photograph`} className="h-full max-h-24 w-full p-3">
   {preview.kind==='ceiling'?<><rect x="10" y="8" width="100" height="73" rx="2" fill="#e7e4da" stroke="#999"/><rect x="22" y="19" width="76" height="49" fill="#f4f1e8" stroke="#d1bf91" strokeWidth="4"/></>:preview.kind==='sanitary'?<><ellipse cx="56" cy="50" rx="26" ry="15" fill="#eee" stroke="#777"/><path d="M40 50v27h25V50M38 37V14h34v23" fill="#eee" stroke="#777"/></>:preview.kind==='fittings'?<><path d="M52 74V27h25" fill="none" stroke="#989fa1" strokeWidth="7"/><ellipse cx="78" cy="30" rx="15" ry="4" fill="#aaa"/></>:preview.kind==='landscape'?<><rect x="8" y="50" width="104" height="28" fill="#7e916b"/><circle cx="38" cy="34" r="18" fill="#547651"/><path d="M38 48v23" stroke="#8b7153" strokeWidth="5"/></>:preview.kind==='pool'?<><rect x="10" y="20" width="100" height="57" fill="#dad5c6"/><rect x="20" y="28" width="80" height="41" fill="#84b6bf"/></>:preview.kind==='window'?<><rect x="27" y="7" width="66" height="74" rx="1" fill={preview.color} stroke="#777"/><rect x="32" y="12" width="25" height="64" fill="#a9c5ce"/><rect x="63" y="12" width="25" height="64" fill="#a9c5ce"/></>:
    preview.kind==='door'?<><rect x="32" y="8" width="56" height="74" fill={preview.color} stroke="#777"/><path d="M78 40v12" stroke="#777" strokeWidth="3"/></>:
    preview.kind==='gate'||preview.kind==='railing'?<><path d="M10 25h100M10 70h100" stroke={preview.color} strokeWidth="6"/>{[15,30,45,60,75,90,105].map(x=><path key={x} d={`M${x} 25v45`} stroke="#777" strokeWidth="3"/>)}</>:
    preview.kind==='kitchen'?<><rect x="10" y="45" width="100" height="35" fill={preview.color} stroke="#777"/><path d="M10 45h100M43 46v34M77 46v34" stroke="#777" strokeWidth="3"/></>:
    <rect x="14" y="15" width="92" height="62" fill={preview.color} stroke="#aaa"/>}
  </svg><span className="absolute inset-x-0 bottom-0 bg-bg/85 text-center text-[9px] text-ink-dim">Finish illustration</span>
 </div>
}
