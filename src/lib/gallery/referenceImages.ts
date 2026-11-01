import type {Character} from '../model/brief.ts'

declare const __STYLE_REFERENCE_FILES__: readonly string[]
export type StyleReference={src:string;alt:string;credit:string;licence:string;sourceUrl?:string}
export const STYLE_REFERENCES:Partial<Record<Character,StyleReference>>={
 'coastal-bungalow':{src:'/house-ideas/reference/coastal-bungalow.jpg',alt:'Coastal Bungalow with terracotta roofs, lime-plaster walls and a shaded verandah',credit:'Source and licence to be confirmed',licence:'Unverified'},
 'tropical-beach-villa':{src:'/house-ideas/reference/tropical-beach-villa.jpg',alt:'Tropical Beach Villa with wide shaded eaves, timber screens and decks',credit:'Source and licence to be confirmed',licence:'Unverified'},
}
/** Availability is checked locally at server start/build; absent photos cause
 * no network requests or broken images. Restart Vite after dropping in a photo. */
export function styleReference(character:string,files:readonly string[]=typeof __STYLE_REFERENCE_FILES__==='undefined'?[]:__STYLE_REFERENCE_FILES__){
 const reference=STYLE_REFERENCES[character as Character]
 return reference?{...reference,available:files.includes(reference.src)}:null
}
