import type {Brief} from '../model/brief.ts'

export const CURTAIN_ITEM='window-curtains'
export const CURTAIN_OPTIONS=[
 {id:'curtain-none',name:'No curtains',kind:'none',color:'#ddd8ce',opacity:1,material:0,labour:0},
 {id:'curtain-sheer',name:'Sheer · warm white',kind:'pleated',color:'#f1ece2',opacity:.48,material:650,labour:150},
 {id:'curtain-linen',name:'Linen · natural sand',kind:'pleated',color:'#c9b79c',opacity:1,material:1100,labour:200},
 {id:'curtain-blackout',name:'Blackout · muted sage',kind:'pleated',color:'#68776d',opacity:1,material:1450,labour:250},
 {id:'curtain-roller',name:'Roller blind · soft stone',kind:'roller',color:'#b8b5ac',opacity:1,material:1000,labour:200},
] as const
export type CurtainOption=typeof CURTAIN_OPTIONS[number]
export const curtainOption=(id?:string)=>CURTAIN_OPTIONS.find(o=>o.id===id)
export const curtainDefault=(finish?:string)=>finish==='basic'?'curtain-sheer':finish==='premium'?'curtain-blackout':'curtain-linen'
export function selectedCurtain(brief:Pick<Brief,'finish'|'specs'>,roomId?:string,semanticId?:string):CurtainOption{
 const overrides=brief.specs?.overrides??{}
 return curtainOption((roomId?overrides[`${CURTAIN_ITEM}@${roomId}`]:undefined)??(semanticId?overrides[`${CURTAIN_ITEM}@${semanticId}`]:undefined)??overrides[CURTAIN_ITEM])??curtainOption(curtainDefault(brief.finish))!
}
export const curtainCatalogueItem={id:CURTAIN_ITEM,group:'windows-glass-grills',label:'Window curtains & blinds',scope:'perRoom',level:'main',control:'dropdown',
 note:'Dry-room windows only; wet rooms, kitchens and service spaces are excluded. Installed coverage includes fabric fullness, track and fitting. Concept allowance; obtain a supplier quote.',
 options:CURTAIN_OPTIONS.map(o=>({id:o.id,name:o.name,rateId:o.id,blenderMaterial:'lime_plaster',curtainOptionId:o.id,photos:[],tags:[o.kind],facts:['Illustrative fabric and mechanism preview; not a supplier product photograph.','Rates are provisional installed-coverage allowances; supplier quotation required.']}))}
export const curtainRates=CURTAIN_OPTIONS.map(o=>({id:o.id,unit:'m2',material:o.material,labour:o.labour,city:'Pune',date:'2026-11-07',source:'Concept curtain allowance; supplier quote required',verification:'provisional-allowance'}))
