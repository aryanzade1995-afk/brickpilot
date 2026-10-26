import raw from './catalogue.json' with {type:'json'}
import type {Brief} from '../model/brief.ts'

export const INTERIOR_MODEL_SECTION='furniture-models'
export const MODEL_PREFIX='visual-model-'
export const INTERIOR_PACK_VERSION='real-interiors-colour-fittings-v3'
export type InteriorAsset=typeof raw.assets[number]
export const interiorAssets:InteriorAsset[]=raw.assets
export const MODEL_CATEGORIES=[
 {id:'sofa',label:'Sofas',assets:['sofa'],item:'interiors',rooms:'Living rooms'},
 {id:'bed',label:'Beds',assets:['bed'],item:'interiors',rooms:'Bedrooms'},
 {id:'armchair',label:'Armchairs',assets:['armchair'],item:'interiors',rooms:'Living rooms'},
 {id:'dining-chair',label:'Chairs',assets:['dining-chair'],item:'interiors',rooms:'Dining rooms and studies'},
 {id:'dining-table',label:'Dining tables',assets:['dining-table'],item:'interiors',rooms:'Dining rooms'},
 {id:'coffee-table',label:'Coffee tables',assets:['coffee-table'],item:'interiors',rooms:'Living rooms'},
 {id:'wardrobe',label:'Wardrobes',assets:['wardrobe'],item:'interiors',rooms:'Bedrooms'},
 {id:'nightstand',label:'Bedside tables',assets:['nightstand'],item:'interiors',rooms:'Bedrooms'},
 {id:'fan',label:'Ceiling fans',assets:['fan'],item:'fans',rooms:'Rooms with a selected fan'},
 {id:'toilet',label:'Toilets',assets:['toilet-modern','toilet','toilet-wall'],item:'sanitary',rooms:'Bathrooms'},
 {id:'basin',label:'Washbasins',assets:['basin'],item:'bath-basin',rooms:'Bathrooms'},
 {id:'bathtub',label:'Bathtubs',assets:['bathtub'],item:'bath-tub',rooms:'Where a bath is already placed'},
 {id:'kitchen-sink',label:'Kitchen sinks & taps',assets:['kitchen-sink'],item:'kitchen-sink',rooms:'Kitchens'},
 {id:'kitchen-base',label:'Kitchen base cabinets',assets:['kitchen-base','kitchen-drawers'],item:'kitchen-cabinets',rooms:'Kitchens'},
 {id:'kitchen-upper',label:'Kitchen wall cabinets',assets:['kitchen-upper'],item:'kitchen-cabinets',rooms:'Kitchens'},
 {id:'kitchen-hob',label:'Kitchen hobs',assets:['kitchen-hob'],item:'interiors',rooms:'Existing hob positions'},
 {id:'washing-machine',label:'Washing machines',assets:['washing-machine'],item:'interiors',rooms:'Where an appliance is already placed'},
 {id:'lamp',label:'Pendant lights',assets:['lamp'],item:'light-fittings',rooms:'Existing pendant positions'},
 {id:'exhaust',label:'Exhaust fans',assets:['exhaust'],item:'electrical-exhaust',rooms:'Wet rooms and kitchens'},
] as const
export type ModelCategory=typeof MODEL_CATEGORIES[number]['id']
export const interiorAsset=(id:string)=>interiorAssets.find(a=>a.id===id)
export function selectedInteriorModel(brief:Pick<Brief,'specs'>,category:ModelCategory,roomId?:string){
 const key=MODEL_PREFIX+category,overrides=brief.specs?.overrides??{}
 const saved=(roomId?overrides[`${key}@${roomId}`]:undefined)??overrides[key]??'auto'
 return saved==='procedural'||saved==='auto'||MODEL_CATEGORIES.find(c=>c.id===category)!.assets.some(id=>id===saved)?saved:'auto'
}
export function setInteriorModel(brief:Brief,category:ModelCategory,value:string,roomId?:string):Brief{
 const allowed=['auto','procedural',...MODEL_CATEGORIES.find(c=>c.id===category)!.assets]
 if(!allowed.includes(value))throw new Error('Unknown interior model choice')
 const key=MODEL_PREFIX+category+(roomId?`@${roomId}`:'')
 return {...brief,specs:{...brief.specs,overrides:{...brief.specs.overrides,[key]:value}}}
}
export const interiorModelSignature=(brief:Pick<Brief,'specs'>)=>JSON.stringify([INTERIOR_PACK_VERSION,interiorAssets.map(a=>[a.id,a.sha256]),Object.entries(brief.specs?.overrides??{}).filter(([k])=>k.startsWith(MODEL_PREFIX)).sort(([a],[b])=>a.localeCompare(b))])
