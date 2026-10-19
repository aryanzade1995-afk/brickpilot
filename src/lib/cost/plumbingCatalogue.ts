/** Plumbing choices and provisional rate adjustments, separate from building geometry. */
export const PLUMBING_SIZES = {
  'water-pipe-size': {label:'Water branch pipe size',sizes:[15,20,25,32],defaultSize:20},
  'water-riser-size': {label:'Water main / riser size',sizes:[25,32,40,50],defaultSize:32},
  'waste-pipe-size': {label:'Waste pipe size',sizes:[50,75],defaultSize:75},
  'soil-pipe-size': {label:'Soil / drain pipe size',sizes:[110,160],defaultSize:110},
} as const
export const PLUMBING_ITEM_IDS = [...Object.keys(PLUMBING_SIZES),'underground-water-tank','drain-tank']
export const PLUMBING_CONTROL_IDS = [...PLUMBING_ITEM_IDS,'water-pipes','drain-pipes','water-tanks']
const option=(id:string,name:string,rateId='plumbing-config')=>({id,name,rateId,blenderMaterial:'white_plaster',
  facts:['Concept allowance; confirm pipe class, capacity and installed price with your supplier.'],tags:['concept-allowance'],photos:[]})
const item=(id:string,label:string,options:ReturnType<typeof option>[],note:string)=>({id,label,options,note,group:'plumbing-sanitary',scope:'house',level:'technical',control:'dropdown'})
export const plumbingItems = [
  ...Object.entries(PLUMBING_SIZES).map(([id,s])=>item(id,s.label,s.sizes.map(size=>option(`mm${size}`,`${size} mm`)),
    'Supply sizes are nominal; waste and soil sizes are outside diameters. Final hydraulic sizing is separate.')),
  item('underground-water-tank','Underground water tank',[
    option('off','No underground water tank','plumbing-off'),option('auto','Automatic capacity','underground-rcc'),
    ...[3000,5000,10000,15000].map(l=>option(`l${l}`,`${l.toLocaleString('en-IN')} L RCC water tank`,'underground-rcc')),
  ],'Clean-water storage only. Allowance includes RCC shell, waterproofing, cover and normal excavation; pump and difficult ground excluded.'),
  item('drain-tank','Drain / septic tank',[
    option('off','No drain tank','plumbing-off'),option('chamber','Drain inspection chamber','drain-chamber'),
    option('septic3000','3,000 L septic tank','drain-septic'),option('septic5000','5,000 L septic tank','drain-septic'),
    option('holding5000','5,000 L sealed holding tank','drain-holding'),option('holding10000','10,000 L sealed holding tank','drain-holding'),
  ],'Separate from drinking water. Septic disposal/soak field, approvals, pumping and groundwater checks require a site design and separate quote.'),
]
export const plumbingDefaults = {...Object.fromEntries(Object.entries(PLUMBING_SIZES).map(([id,s])=>[id,`mm${s.defaultSize}`])),
  'underground-water-tank':'auto','drain-tank':'off'}
const rate=(id:string,unit:string,material:number,labour:number)=>({id,unit,material,labour,city:'Pune',date:'2026-10-18',
  source:'Concept plumbing allowance; supplier quote required',verification:'provisional-allowance'})
export const plumbingTankRates=[rate('plumbing-config','item',0,0),rate('plumbing-off','item',0,0),
  rate('underground-rcc','m3',9000,5000),rate('drain-chamber','item',4200,1800),
  rate('drain-septic','m3',9000,4000),rate('drain-holding','m3',10000,5000)]
export const pipeRateFactor=(system:'water'|'drain',diameter:number)=>system==='water'?diameter/20:diameter/110
/** Existing per-metre material/labour rates are the base; size factors remain explicit allowances. */
export function plumbingPipeRates(base:{id:string;material:number;labour:number}[]){
  return base.filter(r=>/^(water-pipes|drain-pipes)-/.test(r.id)).flatMap(r=>{
    const water=r.id.startsWith('water-pipes-'),sizes=water?[15,20,25,32,40,50]:[50,75,110,160]
    return sizes.map(size=>{const factor=pipeRateFactor(water?'water':'drain',size)
      return rate(`${r.id}-${size}mm`,'m',Math.round(r.material*factor*100)/100,Math.round(r.labour*factor*100)/100)})
  })
}
