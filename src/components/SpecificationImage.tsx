import { useState } from 'react'
import type { SpecOption } from '@/lib/cost/workspace.ts'
import { assetUrl } from '@/lib/cost/workspace.ts'
import { flooringProduct } from '@/lib/flooring/catalogue.ts'

/** Never substitute a generic texture or a render for an unavailable supplier image. */
export function SpecificationImage({ option, className = '' }: { option: SpecOption; className?: string }) {
  const product = flooringProduct(option.flooringProductId), photo = option.photos.find(p => p.kind === 'closeup')
  const src = product ? product.thumbnail : photo ? assetUrl(photo.webFile ?? photo.file) : null
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <div className={`flex items-center justify-center bg-bg-inset p-2 text-center text-[11px] text-ink-faint ${className}`}>Image unavailable</div>
  return <img src={src} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)}
    alt={product ? `${product.manufacturer} — ${product.productName} product swatch` : `${option.name} real texture close-up`}
    className={className} />
}
