import type {ImpactDocument} from './schema.ts'

/** One source for the card and diagram. U-values describe the whole assembly;
 * they do not establish its materials, thicknesses, SRI or peak solar gain. */
export function roofComparison(input:ImpactDocument['climate'],planAreaM2:number){
 const areaM2=input.areaM2??planAreaM2
 const currentU=input.currentRoofU,proposedU=input.proposedRoofU,deltaT=input.temperatureDifferenceK
 const missing:string[]=[]
 if(!Number.isFinite(areaM2)||areaM2<=0)missing.push('Roof area')
 for(const [label,value] of [['Current U-value',currentU],['Proposed U-value',proposedU],['Temperature difference',deltaT]] as const)
  if(value===null||!Number.isFinite(value)||value<0)missing.push(label)
 const ready=missing.length===0
 const currentW=ready?areaM2*currentU!*deltaT!:null
 const proposedW=ready?areaM2*proposedU!*deltaT!:null
 const differenceW=currentW!==null&&proposedW!==null?currentW-proposedW:null
 const percent=currentW!==null&&currentW>0?differenceW!/currentW*100:differenceW===0?0:null
 return {ready,missing,areaM2,areaBasis:input.areaM2===null?'From current plan':'Entered roof area',currentU,proposedU,deltaT,currentW,proposedW,differenceW,percent,source:input.source}
}
