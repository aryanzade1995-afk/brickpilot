import {translate as t} from '@/lib/i18n/index.ts'

/** A light drafting animation; the surrounding form remains usable. */
export function SpaceValidation({compact=false,label='Checking available space'}:{compact?:boolean;label?:string}){
 return <div className={`space-validation flex items-center ${compact?'gap-2':'gap-4 py-2'}`} role="status" aria-live="polite">
  <svg viewBox="0 0 64 64" aria-hidden="true" className={`${compact?'h-5 w-5':'h-14 w-14'} shrink-0 text-ink-dim`} fill="none">
   <path d="M10 10h44v44H10zM10 34h26V10M36 34v20M36 26h18" stroke="currentColor" strokeWidth="1.5"/>
   <path d="M22 34a10 10 0 0 1 10 10M32 34v10" stroke="currentColor" strokeWidth="1" opacity=".4"/>
   <path className="space-validation-scan" d="M7 16h50" stroke="currentColor" strokeWidth="2"/>
  </svg>
  <div className="min-w-0"><p className={compact?'text-xs text-ink-dim':'text-sm font-medium text-ink'}>{t(label)}<span className="space-validation-dots" aria-hidden="true">…</span></p>
   {!compact&&<p className="mt-1 text-xs leading-relaxed text-ink-faint">{t('Matching your rooms, plot and setbacks. You can keep editing.')}</p>}
  </div>
 </div>
}
