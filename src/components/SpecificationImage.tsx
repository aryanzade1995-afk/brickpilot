import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useState } from 'react'
import type { SpecOption } from '@/lib/cost/workspace.ts'
import { optionImage } from '@/lib/finishes/optionImage.ts'
import { flooringProduct } from '@/lib/flooring/catalogue.ts'
import { finishProduct } from '@/lib/finishes/catalogue.ts'
import {curtainOption} from '@/lib/curtains/catalogue.ts'

/** Never substitute a generic texture or a render for an unavailable supplier image. */
export function SpecificationImage({ option, className = '' }: { option: SpecOption; className?: string }) {
  useLanguage(s => s.language);

  const product = flooringProduct(option.flooringProductId), finish = finishProduct(option.finishProductId)
  const src = optionImage(option)?.src
  const [failed, setFailed] = useState<string | null>(null)
  const curtain=curtainOption(option.curtainOptionId)
  if(curtain)return <div className={`relative overflow-hidden bg-[#e9e7e1] ${className}`} role="img" aria-label={`${curtain.name} · illustrative curtain preview`}><svg viewBox="0 0 160 120" className="h-full w-full"><rect x="28" y="18" width="104" height="88" fill="#cbd9dc" stroke="#8a9391"/><path d="M80 20V104M30 62H130" stroke="#f9faf8" strokeWidth="3"/><path d="M18 13H142" stroke="#645e55" strokeWidth="4"/>{curtain.kind==='roller'?<><rect x="23" y="17" width="114" height="61" fill={curtain.color}/><path d="M23 78H137" stroke="#787870" strokeWidth="3"/></>:curtain.kind!=='none'&&[24,101].map(x=><g key={x} opacity={curtain.opacity}><path d={`M${x} 18h35v88l-7-3-7 3-7-3-7 3-7-2z`} fill={curtain.color}/>{[5,14,23,31].map(n=><path key={n} d={`M${x+n} 19v82`} stroke="#333" opacity=".14"/>)}</g>)}</svg><span className="absolute bottom-1 right-1 bg-white/85 px-1 text-[9px] text-ink-dim">Illustration</span></div>
  if (!src || failed === src) return <div className={`flex items-center justify-center bg-bg-inset p-2 text-center text-[11px] text-ink-faint ${className}`}>{translateUi("Image unavailable")}</div>
  return <img src={src} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)}
    alt={translateUi(product ? `${product.manufacturer} — ${product.productName} product swatch` : finish ? `${finish.brand} — ${finish.productName} ${finish.image.kind === 'generic-material-closeup' ? 'generic material close-up' : 'real product photograph'}` : `${option.name} real texture close-up`)}
    className={className} />
}
