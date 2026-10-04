import { z } from 'zod'
import raw from './paint-shades.json' with { type: 'json' }
import type { Brief } from '../model/brief.ts'
const shade=z.strictObject({id:z.string(),name:z.string(),family:z.string(),hex:z.string().regex(/^#[A-F0-9]{6}$/),sourceUrl:z.url().refine(u=>new URL(u).hostname==='www.asianpaints.com'),catalogueUrl:z.url(),manufacturer:z.literal('Asian Paints'),verifiedAt:z.iso.date(),status:z.literal('official-digital-swatch')})
export const paintShades=z.strictObject({schemaVersion:z.literal(1),shades:z.array(shade)}).parse(raw).shades
export const PAINT_COLOUR='interior-paint-colour'
export function colourValue(value?:string) {
 const official=paintShades.find(s=>`ap:${s.id}`===value)
 if(official)return {...official,label:`${official.name} · ${official.id}`,value:`ap:${official.id}`}
 const hex=/^#[\da-f]{6}$/i.test(value??'')?value!.toUpperCase():'#E4E1DA'
 return {hex,label:value?`Custom ${hex}`:'Warm neutral (default)',value:hex,sourceUrl:undefined}
}
export function paintColour(brief:Brief,room?:string) {
 const overrides=brief.specs.overrides,semantic=room?.slice(room.indexOf(':')+1)
 return colourValue((room&& (overrides[`${PAINT_COLOUR}@${room}`]??overrides[`${PAINT_COLOUR}@${semantic}`]))||overrides[PAINT_COLOUR])
}
export function applyPaintColour(brief:Brief,value:string,applicable:string[],selected:string[]) {
 if(!/^#[\da-f]{6}$/i.test(value)&&!paintShades.some(s=>`ap:${s.id}`===value))return brief
 const next={...brief,specs:{...brief.specs,overrides:{...brief.specs.overrides}}},o=next.specs.overrides
 if(!applicable.length||applicable.every(id=>selected.includes(id))){
  for(const key of Object.keys(o))if(key===PAINT_COLOUR||key.startsWith(`${PAINT_COLOUR}@`))delete o[key]
  o[PAINT_COLOUR]=value
 }else for(const id of selected.filter(id=>applicable.includes(id))){delete o[`${PAINT_COLOUR}@${id.slice(id.indexOf(':')+1)}`];o[`${PAINT_COLOUR}@${id}`]=value}
 return next
}
export const colourFamilies=['white','off-white','grey','brown','yellow','orange','red','pink','purple','blue','green']
export function groupedShades(search='') {
 return colourFamilies.map(family=>({family,shades:paintShades.filter(s=>s.family===family&&`${s.name} ${s.id}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>brightness(b.hex)-brightness(a.hex))})).filter(g=>g.shades.length)
}
function brightness(hex:string){return .2126*parseInt(hex.slice(1,3),16)+.7152*parseInt(hex.slice(3,5),16)+.0722*parseInt(hex.slice(5,7),16)}
export function hslHex(h:number,s:number,l:number){
 const a=s/100*Math.min(l/100,1-l/100),channel=(n:number)=>{const k=(n+h/30)%12;return Math.round(255*(l/100-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0')}
 return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase()
}

export function hexHsl(hex:string):[number,number,number] {
 const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2
 const h=d===0?0:max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4
 return [h*60,d===0?0:d/(1-Math.abs(2*l-1))*100,l*100]
}
