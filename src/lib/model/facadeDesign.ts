import {z} from 'zod'

export const FACADE_DESIGNS = [
 ['D01','Cantilever Ribbon','Deep horizontal frames'],['D02','Glass Bridge','Asymmetric glazed accents'],
 ['D03','Horizon House','Layered slab edges'],['D04','Curved Corner','Rounded architectural panels'],
 ['D05','Terrace Garden','Timber pergolas and trellises'],['D06','Split Pavilion','Paired volumes and a quiet centre'],
 ['D07','Diagonal Blade','Angled fins and folded panels'],['D08','Stone Tower','Vertical stone piers'],
 ['D09','Floating Carport','Light canopy and entrance frames'],['D10','Perforated Screen','Open privacy lattice'],
] as const
export const facadeDesignSchema=z.object({
 version:z.literal(1).default(1),facadeStyle:z.enum(['MIXED','D01','D02','D03','D04','D05','D06','D07','D08','D09','D10']).default('MIXED'),
 facadeSeed:z.number().int().min(0).max(4294967295),facadeVariation:z.number().min(0).max(1).default(.65),
 materialPalette:z.enum(['selected','warm-timber','stone-metal','light-mineral']).default('selected'),
})
export type FacadeDesign=z.infer<typeof facadeDesignSchema>
export type FacadeRecipe=(typeof FACADE_DESIGNS)[number][0]
export function automaticFacadeDesign(seed:number,current?:FacadeDesign):FacadeDesign {
 return {...current,version:1,facadeStyle:'MIXED',facadeSeed:current?.facadeSeed??(seed>>>0),facadeVariation:current?.facadeVariation??.65,materialPalette:current?.materialPalette??'selected'}
}
