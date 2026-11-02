import {useState} from 'react'
import {translate as t} from '@/lib/i18n/index.ts'
import type {styleReference} from '@/lib/gallery/referenceImages.ts'

export function StyleReferencePhoto({reference,small=false}:{reference:NonNullable<ReturnType<typeof styleReference>>;small?:boolean}){
 const [failed,setFailed]=useState(false)
 const available=reference.available&&!failed
 return <figure className={small?'mx-auto w-full max-w-xs':'w-full'}>
  <div className="house-preview flex aspect-[4/3] items-center justify-center overflow-hidden border border-line bg-bg-inset">
   {available?<img src={reference.src} alt={t(reference.alt)} decoding="async" width={1200} height={900} onError={()=>setFailed(true)} className="h-full w-full object-contain"/>:<div role="status" className="p-6 text-center"><p className="font-display text-xl">{t('Reference photo coming soon')}</p><p className="mt-2 text-xs text-ink-dim">{t('Add the supplied reference photo to this slot.')}</p></div>}
  </div>
  <figcaption className="mt-2 text-xs leading-relaxed text-ink-dim"><p>{t('Reference photo · inspiration only')}</p><p className="mt-1">{t(reference.credit)}</p>{available&&<a className="mt-2 inline-block underline underline-offset-4" href={reference.src} download>{t('Download')}</a>}</figcaption>
 </figure>
}
