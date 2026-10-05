import { useState } from 'react'
import type { SpecOption } from '@/lib/cost/workspace.ts'
import { optionImage } from '@/lib/finishes/optionImage.ts'
import { flooringProduct } from '@/lib/flooring/catalogue.ts'
import { finishProduct } from '@/lib/finishes/catalogue.ts'

/** Never substitute a generic texture or a render for an unavailable supplier image. */
export function SpecificationImage({ option, className = '' }: { option: SpecOption; className?: string }) {
  const product = flooringProduct(option.flooringProductId), finish = finishProduct(option.finishProductId)
  const src = optionImage(option)?.src
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <div className={`flex items-center justify-center bg-bg-inset p-2 text-center text-[11px] text-ink-faint ${className}`}>Image unavailable</div>
  return <img src={src} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)}
    alt={product ? `${product.manufacturer} — ${product.productName} product swatch` : finish ? `${finish.brand} — ${finish.productName} ${finish.image.kind === 'generic-material-closeup' ? 'generic material close-up' : 'real product photograph'}` : `${option.name} real texture close-up`}
    className={className} />
}
