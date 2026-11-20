import {useId, useState} from 'react'
import {Check} from 'lucide-react'
import {MODERN_DESIGNS, MODERN_STYLES, type ModernStyle} from '@/lib/model/facadeDesign.ts'

function DesignImage({styleId}:{styleId:ModernStyle}) {
  const [failed,setFailed]=useState(false)
  return failed
    ? <span className="grid aspect-[16/10] place-items-center bg-bg-inset text-xs text-ink-dim">Preview unavailable</span>
    : <img className="aspect-[16/10] w-full object-cover" loading="lazy" decoding="async" alt="" src={`/modern-house-designs/${styleId}.webp`} onError={()=>setFailed(true)}/>
}

export function ModernDesignCards({value,onChange}:{value?:string;onChange:(value:ModernStyle)=>void}) {
  const group=useId()
  return <fieldset className="min-w-0">
    <legend className="font-display text-xl">Choose Your Modern House Design</legend>
    <p className="mt-1 text-sm text-ink-dim">Explore four modern architectural styles. Select your preferred design to guide your home’s 3D appearance.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {MODERN_STYLES.map(id=><label key={id} className="relative block cursor-pointer">
        <input className="peer sr-only" type="radio" name={group} checked={value===id} onChange={()=>onChange(id)} aria-label={MODERN_DESIGNS[id].name}/>
        <span className="block h-full overflow-hidden rounded border border-line bg-surface transition-colors peer-checked:border-ink peer-checked:ring-1 peer-checked:ring-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4">
          <DesignImage styleId={id}/>
          <span className="block p-3"><strong className="block font-display text-lg">{MODERN_DESIGNS[id].name}</strong>
            <span className="mt-1 block text-xs text-ink-dim">{MODERN_DESIGNS[id].description}</span></span>
        </span>
        {value===id&&<span aria-hidden="true" className="absolute right-2 top-2 rounded-full bg-ink p-1 text-white"><Check size={15}/></span>}
      </label>)}
    </div>
    <p className="mt-2 text-xs text-ink-dim">Style inspiration — final design adapts to your floor plan and site constraints.</p>
  </fieldset>
}
