import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useState, type PointerEvent } from 'react'
import { colourValue, groupedShades, hslHex, hexHsl } from '@/lib/finishes/paint.ts'
export function PaintColours({value,onChange,brand}:{value:string;onChange:(v:string)=>void;brand?:string}) {
  useLanguage(s => s.language);

 const [search,setSearch]=useState('')
 const picked=colourValue(value),[hue,saturation,light]=hexHsl(picked.hex)
 const update=(h:number,s:number,l:number)=>onChange(hslHex(h,s,l))
 const wheel=(e:PointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2;update((Math.atan2(y,x)*180/Math.PI+90+360)%360,Math.min(100,Math.hypot(x,y)/(r.width/2)*100),light)}
 const pickedManufacturer = 'manufacturer' in picked ? (picked.manufacturer as string) : 'Asian Paints'
 const brandName = brand ?? (pickedManufacturer || 'Asian Paints')
 const brandUrl = picked.sourceUrl ?? (
   brandName.toLowerCase().includes('berger') ? 'https://www.bergerpaints.com' :
   brandName.toLowerCase().includes('nerolac') ? 'https://www.nerolac.com' :
   brandName.toLowerCase().includes('dulux') ? 'https://www.dulux.in' :
   brandName.toLowerCase().includes('opus') ? 'https://www.birlaopus.com' :
   'https://www.asianpaints.com/colour-catalogue.html'
 )
 return <section className="mb-6 rounded-xl border border-line p-4"><h3 className="font-display text-lg">{translateUi("Wall colour")}</h3><p className="mt-1 text-xs text-ink-dim">{translateUi("Choose a colour first, then keep or change your paint quality below.")}</p>
  <div className="mt-4 grid grid-cols-[120px_minmax(0,1fr)] items-center gap-4">
   <div role="slider" tabIndex={0} aria-label={translateUi("Colour wheel hue")} aria-valuemin={0} aria-valuemax={359} aria-valuenow={Math.round(hue)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();update((hue+(e.key==='ArrowRight'?5:355))%360,saturation,light)}}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);wheel(e)}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))wheel(e)}} onPointerUp={e=>e.currentTarget.releasePointerCapture(e.pointerId)} className="relative h-[120px] w-[120px] touch-none cursor-crosshair rounded-full border border-line" style={{background:'radial-gradient(circle, white, transparent 72%), conic-gradient(red, yellow, lime, cyan, blue, magenta, red)'}}>
    <span className="absolute h-3 w-3 rounded-full border-2 border-white shadow" style={{left:`${50+Math.sin(hue*Math.PI/180)*saturation*.45}%`,top:`${50-Math.cos(hue*Math.PI/180)*saturation*.45}%`,background:picked.hex,transform:'translate(-50%,-50%)'}}/></div>
   <div className="space-y-3"><label className="block text-xs">{translateUi("Lightness")}<input aria-label={translateUi("Colour lightness")} type="range" min="8" max="96" value={light} onChange={e=>update(hue,saturation,Number(e.target.value))} className="mt-2 w-full"/></label>
    <label className="flex items-center gap-2 text-xs">{translateUi("Custom colour")}<input aria-label={translateUi("Custom paint colour")} type="color" value={picked.hex} onInput={e=>onChange(e.currentTarget.value.toUpperCase())} onChange={e=>onChange(e.target.value.toUpperCase())} className="h-9 w-12 bg-transparent"/><span>{translateUi(picked.hex)}</span></label></div>
  </div><p className="mt-3 text-sm">{translateUi(picked.label)}</p><p className="mt-2 text-[11px] leading-relaxed text-ink-dim">{translateUi("Screen colours are approximate. Confirm a physical shade card, sample patch and compatibility with the chosen paint system; special tint charges require a quote.")}</p>
  <label className="mt-4 block text-xs">{translateUi("Search official shades")}<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={translateUi("Shade name or code")} className="mt-2 w-full rounded border border-line bg-bg p-2"/></label>
  <div className="mt-4 max-h-80 space-y-4 overflow-y-auto pr-1">{groupedShades(search).map(g=><div key={g.family}><h4 className="mb-2 text-xs capitalize">{translateUi(g.family.replace('-',' '))} {translateUi(" · light to deep")}</h4><div className="grid grid-cols-4 gap-2">{g.shades.map(s=><button key={s.id} type="button" onClick={()=>onChange(`ap:${s.id}`)} aria-pressed={value===`ap:${s.id}`} aria-label={translateUi(`${s.name} ${s.id}`)} className={`rounded border p-1 text-left ${value===`ap:${s.id}`?'border-ink':'border-line'}`}><span className="mb-1 block h-8 rounded" style={{background:s.hex}}/><span className="block text-[9px] leading-tight">{translateUi(s.name)}<br/>{translateUi(s.id)}</span></button>)}</div></div>)}</div>
  <a href={brandUrl} target="_blank" rel="noopener noreferrer" title={translateUi("Opens the manufacturer's website. Prices and availability there may differ from this concept estimate.")} aria-label={translateUi(`Official ${brandName} shade reference`)} className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-inset/70 px-3 py-1.5 text-xs font-sans font-medium text-ink shadow-xs transition-colors hover:border-ink hover:bg-bg"><span>{translateUi(`Official ${brandName} shade reference`)}</span><span className="font-sans text-accent">↗</span></a>
 </section>
}
