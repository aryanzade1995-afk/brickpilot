import type {FacadeDesign} from './facadeDesign.ts'

export const EXTERIOR_PALETTES = [
 {id:'SAGE_LIMESTONE',name:'Sage & limestone',colours:['#E9E5D9','#829484','#506B5B']},
 {id:'TERRACOTTA_CREAM',name:'Terracotta & cream',colours:['#ECE0CB','#BB7156','#854B37']},
 {id:'SLATE_BLUE_OAK',name:'Slate blue & oak',colours:['#E4E7E4','#667E93','#3F566B']},
 {id:'CHARCOAL_WOOD_WHITE',name:'Charcoal & warm white',colours:['#E4E3DD','#565A59','#303938']},
] as const
export function exteriorColours(id?:FacadeDesign['exteriorPalette']){return EXTERIOR_PALETTES.find(p=>p.id===id)?.colours}
export function exteriorRoleColour(role:string,id?:FacadeDesign['exteriorPalette']){
 const colours=exteriorColours(id);if(!colours)return undefined
 return ['wall','primary_wall'].includes(role)?colours[0]:['concrete','secondary_wall'].includes(role)?colours[1]:role==='accent'?colours[2]:undefined
}
