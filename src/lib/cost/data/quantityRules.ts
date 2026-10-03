import { z } from 'zod'
import raw from './quantity-rules.json' with { type: 'json' }
const positive = z.number().positive().finite()
const nonnegative = z.number().nonnegative().finite()
const pointRule = z.object({plumbing:nonnegative.int(),electrical:nonnegative.int()}).strict()
export const quantityRulesSchema = z.object({
  version:z.string(),qualification:z.string(),
  seedIdentityDefaults:z.object({columnMm:positive,slabMm:positive}).strict(),
  columnsByStoreysMm:z.array(z.object({corner:positive,edge:positive,interior:positive}).strict()).length(4),
  beam:z.object({spanDepthRatio:positive,roundMm:positive,minDepthMm:positive,widthMm:positive}).strict(),
  slab:z.object({shortSpanLimitMm:positive,shortThicknessMm:positive,longThicknessMm:positive}).strict(),
  footing:z.object({baseWidthMm:positive,perStoreyMm:positive,thicknessMm:positive,perStoreyThicknessMm:positive,depthBelowGradeMm:positive,soilFactors:z.object({unknown:positive,firm:positive,rock:positive}).strict(),roundMm:positive}).strict(),
  plinthHeightsMm:z.object({standard:positive,raised:positive,flood:positive}).strict(),
  plinthBeam:z.object({widthMm:positive,depthMm:positive}).strict(),
  earthwork:z.object({workingSpaceMm:nonnegative,pccProjectionMm:nonnegative,pccThicknessMm:positive}).strict(),
  steelKgPerM3:z.object({footings:positive,columns:positive,plinthBeams:positive,beams:positive,slabs:positive,stairs:positive,lintels:positive,chajjas:positive}).strict(),
  concrete:z.object({dryFactor:positive,cementDensityKgM3:positive,bagKg:positive,m20Parts:z.tuple([positive,positive,positive])}).strict(),
  masonryUnitsPerM3:z.object({brick:positive,aac:positive,'concrete-block':positive}).strict(),
  finishes:z.object({skirtingHeightMm:positive,wetTileHeightMm:positive,kitchenDadoHeightMm:positive,kitchenDadoWallRatio:positive.max(1)}).strict(),
  openings:z.object({lintelDepthMm:positive,lintelBearingMm:positive,chajjaProjectionMm:positive,chajjaThicknessMm:positive,glassRatio:positive.max(1),grillRatio:positive.max(1)}).strict(),
  openingLimits:z.object({windowHeadMm:positive,doorHeadMm:positive,entryHeadMm:positive,defaultSillMm:nonnegative,lintelClearanceMm:positive,minWindowHeightMm:positive,minDoorHeightMm:positive}).strict(),
  stairs:z.object({waistMm:positive,landingThicknessMm:positive,guardSides:positive.int()}).strict(),
  roof:z.object({parapetHeightMm:positive,parapetThicknessMm:positive}).strict(),
  site:z.object({gateWidthMm:positive,compoundHeightMm:positive,compoundThicknessMm:positive}).strict(),
  tanks:z.object({litresPerOccupant:positive,storageDays:positive,overheadFraction:positive.max(1),roundLitres:positive,minLitres:positive}).strict(),
  pointsByRoom:z.object({bath:pointRule,kitchen:pointRule,utility:pointRule,bedroom:pointRule,living:pointRule,office:pointRule,pooja:pointRule,circulation:pointRule,other:pointRule}).strict(),
  toleranceMm:positive,openingColumnClearanceMm:nonnegative,memoEntries:positive.int(),notes:z.array(z.string()),
}).strict().superRefine((r,ctx)=>{
  if(r.slab.longThicknessMm<r.slab.shortThicknessMm)ctx.addIssue({code:'custom',message:'Slabs must not shrink with span'})
  r.columnsByStoreysMm.slice(1).forEach((row,i)=>{for(const p of ['corner','edge','interior'] as const)if(row[p]<r.columnsByStoreysMm[i][p])ctx.addIssue({code:'custom',message:'Columns must not shrink with storeys'})})
})
export const quantityRules = quantityRulesSchema.parse(raw)
