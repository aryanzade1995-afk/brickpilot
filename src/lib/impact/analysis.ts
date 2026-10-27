import type { Design } from '../engine/types.ts'
import type { Brief } from '../model/brief.ts'
import type { CostEstimate } from '../cost/boq.ts'
import { specsCatalogue, specificationRate } from '../cost/catalogue.ts'
import type { ValidationReport } from '../rules/index.ts'
import { createBuildingModel } from '../engine/buildingModel.ts'
import { ventilationPaths, AIR_SIDES } from '../utilities/ventilation.ts'
import { entryRamp } from '../engine/entryRamp.ts'
import { rainfallYield, tankStep } from '../water/engineering.ts'
import { impactSchema, type ImpactDocument } from './schema.ts'

export const IMPACT_SOURCES = [
  {label:'BEE residential envelope guidance',url:'https://www.beeindia.gov.in/show_content.php?lang=1&level=2&lid=328&ls_id=202',checked:'2026-10-28'},
  {label:'Universal accessibility guidance',url:'https://depwd.gov.in/en/document/harmonised-guidelines-standards-for-universal-accessibility-in-india-2021/',checked:'2026-10-28'},
  {label:'Rainwater harvesting references',url:'https://jsactr.mowr.gov.in/Public_Dash/KnowledgeCentre.aspx',checked:'2026-10-28'},
]
export type ImpactCheck={id:string;status:'Review'|'Not checked'|'Recorded';title:string;detail:string;href:string}
export function housingTopic(question:string) {
  const q=question.normalize('NFKC').toLowerCase()
  const topics=[
    ['affordability',/\bbudget\b|\bcosts?\b|afford|बजट|बजेट|खर्च|किंमत|कीमत|लागत|सस्ता/],
    ['water',/\bwater\b|\brain(?:fall)?\b|पानी|पाण|पाऊस|पावस|बारिश|वर्षा/],
    ['access',/\bramps?\b|\bstairs?\b|step.free|access|wheelchair|रैंप|रॅम्प|सुलभ|व्हील|प्रवेश/],
    ['climate',/\bair\b|\bheat\b|cool|climate|हवा|गर्मी|उष्ण|थंड|ठंड|वायुवीजन/],
    ['sustainability',/carbon|energy|material|कार्बन|ऊर्जा|साहित्य|सामग्री/],
    ['community',/ngo|community|household|समुदाय|कुटुंब|परिवार/],
    ['safety',/safe|drain|fire|electric|सुरक्ष|निचरा|नाली|आग|विद्युत|वीज/],
  ] as const
  return topics.find(([,pattern])=>pattern.test(q))?.[0]??null
}

/** Read-only comparisons: same measured line/quantity/unit, catalogue installed
 * rate only. No structural reductions, removal of safety systems or mutation. */
export function affordableAlternatives(cost:CostEstimate) {
  const allowed=new Set(['floor-tiles','floor-stone','floor-wood','interior-paint','bathroom-floor','bathroom-wall','kitchen-counter','kitchen-cabinets'])
  return cost.boq.flatMap(line=>{
    if(!allowed.has(line.item)&&!/^floor-/.test(line.item))return []
    const item=specsCatalogue.items.find(i=>i.id===line.item)
    if(!item||line.quantity<=0)return []
    const current=line.specId.split('/')[1]
    const candidates=item.options.filter(o=>o.id!==current&&!/off|none/.test(o.id)).flatMap(o=>{
      const rate=specificationRate(o.rateId)
      return rate.unit.replace('m2','m²').replace('m3','m³')===line.unit&&rate.installed<line.rate?[{id:o.id,name:o.name,rate:rate.installed}]:[]
    }).sort((a,b)=>a.rate-b.rate)
    const best=candidates[0]
    return best?[{lineId:line.id,label:line.label,current:line.specification,alternative:best.name,quantity:line.quantity,unit:line.unit,difference:(line.rate-best.rate)*line.quantity,href:`/workspace/finishes?tab=specifications&section=${item.group}${line.roomId?'&room='+encodeURIComponent(line.roomId):''}`}]:[]
  }).sort((a,b)=>b.difference-a.difference).slice(0,8)
}

export function waterImpact(input:ImpactDocument['water'],geometryKey:string) {
  if(input.geometryKey&&input.geometryKey!==geometryKey)return {state:'Review roof inputs',litres:null,storage:null,days:null} as const
  if(input.rainfallMm===null||input.areaM2===null||input.runoff===null||input.efficiency===null||!input.source.trim())return {state:'More information needed',litres:null,storage:null,days:null} as const
  const litres=rainfallYield(input.rainfallMm,input.areaM2,input.runoff,input.efficiency).collectedLitres
  // A single event into an empty tank, then one day's entered demand. This is
  // not an annual reliability analysis or a prediction of actual water saved.
  const storage=input.capacityL===null||input.dailyDemandL===null?null:tankStep(input.capacityL,0,litres,input.dailyDemandL)
  return {state:'Calculated scenario',litres,storage,days:input.capacityL!==null&&input.dailyDemandL!==null&&input.dailyDemandL>0?input.capacityL/input.dailyDemandL:null} as const
}
export function carbonImpact(cost:CostEstimate,doc:ImpactDocument) {
  let low=0,high=0,covered=0;const excluded:string[]=[],boundaries=new Set<string>()
  for(const factor of doc.carbon){
    const line=cost.boq.find(l=>l.id===factor.lineId)
    if(!line||factor.specId!==line.specId||factor.unit!==line.unit||factor.geometryKey!==cost.quantities.geometryKey){excluded.push(factor.lineId);continue}
    boundaries.add(factor.boundary.trim().toLowerCase())
    low+=line.quantity*factor.low;high+=line.quantity*factor.high;covered++
  }
  return {low:boundaries.size<=1?low:null,high:boundaries.size<=1?high:null,covered,excluded,totalLines:cost.boq.length,mixedBoundaries:boundaries.size>1}
}
/** Steady-state roof conduction only: watts = U (W/m²K) × area × ΔT.
 * Does not include solar gain, thermal mass, air leakage or AC performance. */
export function roofHeatComparison(c:ImpactDocument['climate']) {
  c=impactSchema.shape.climate.parse(c)
  if(!c.source.trim()||c.areaM2===null||c.currentRoofU===null||c.proposedRoofU===null||c.temperatureDifferenceK===null)return null
  const currentW=c.areaM2*c.currentRoofU*c.temperatureDifferenceK,proposedW=c.areaM2*c.proposedRoofU*c.temperatureDifferenceK
  return {currentW,proposedW,differenceW:currentW-proposedW}
}
/** Household codes identify local anonymous cohorts. Repeated codes count once;
 * repeated measurements are never summed as if they were independent outcomes. */
export function pilotImpact(doc:ImpactDocument) {
  const latest=new Map<string,ImpactDocument['pilots'][number]>()
  for(const row of doc.pilots){const key=row.householdCode.trim().toLowerCase(),before=latest.get(key);if(!before||row.date>=before.date)latest.set(key,row)}
  const supported=[...latest.values()].filter(r=>r.stage==='supported'&&r.evidence.trim())
  const costs=supported.filter(r=>r.sameScope&&r.baselineCostInr!==null&&r.actualCostInr!==null)
  return {households:supported.length,planned:[...latest.values()].filter(r=>r.stage==='planned').length,costDifference:costs.reduce((n,r)=>n+r.baselineCostInr!-r.actualCostInr!,0),costRecords:costs.length,measuredWaterL:supported.reduce((n,r)=>n+(r.measuredWaterL??0),0),waterRecords:supported.filter(r=>r.measuredWaterL!==null).length,resilienceRecords:supported.filter(r=>r.resilienceNote.trim()).length}
}
export function analyzeImpact(design:Design,brief:Brief,cost:CostEstimate,report:ValidationReport,document:ImpactDocument) {
  const doc=impactSchema.parse(document),model=createBuildingModel({...design,model:{...design.model,brief}})
  const air=AIR_SIDES.map(side=>ventilationPaths(model,side,true))
  const ramp=entryRamp({...design,model:{...design.model,brief}})
  const checks:ImpactCheck[]=report.findings.filter(f=>f.category!=='vastu'&&f.severity!=='info').map((f,i)=>({id:`plan:${i}`,status:'Review',title:'Plan review',detail:f.message,href:'/workspace/plan'}))
  checks.push(
    {id:'air',status:air.some(a=>!a.paths.length)?'Review':'Recorded',title:'Natural ventilation',detail:'Opening-to-opening paths are illustrative. Operability, weather, airflow rates and indoor temperatures need review.',href:'/workspace/utilities?view=air'},
    {id:'drain',status:'Not checked',title:'Drainage and discharge',detail:'Review the recorded drainage network, invert levels and approved outlet with a qualified professional.',href:'/workspace/utilities?service=drainage'},
    {id:'electric',status:'Not checked',title:'Electrical safety',detail:'Cable loading, wet-area protection, earthing and installed clearances need an electrical design review.',href:'/workspace/utilities'},
    {id:'flood',status:'Not checked',title:'Flood and site levels',detail:'A raised plinth alone does not establish flood safety. Obtain surveyed levels and local flood information.',href:'/workspace'},
    {id:'access',status:'Review',title:'Step-free access',detail:ramp?'A proposed ramp is recorded. Verify landings, clear widths, gradients and site levels.':'A continuous step-free entrance has not been verified.',href:'/workspace'},
    {id:'kitchen',status:'Not checked',title:'Kitchen safety',detail:'Cooking ventilation, fuel installation, fire protection and appliance clearances require site verification.',href:'/workspace/utilities'},
  )
  const water=waterImpact(doc.water,cost.quantities.geometryKey),carbon=carbonImpact(cost,doc)
  const budget=doc.budgetInr??brief.budget?.amount??null
  const current=doc.energy.currentMonthlyKwh,proposed=doc.energy.proposedMonthlyKwh
  return {conceptEstimate:cost.expected,model,air,ramp,checks:[...checks.filter(c=>!c.id.startsWith('plan:')),...checks.filter(c=>c.id.startsWith('plan:'))],water,carbon,heat:roofHeatComparison(doc.climate),budget,budgetDifference:budget===null?null:budget-cost.expected,alternatives:affordableAlternatives(cost),pilots:pilotImpact(doc),annualEnergyDifference:current!==null&&proposed!==null&&doc.energy.source.trim()?(current-proposed)*12:null,narrowestDoorMm:model.doors.length?Math.min(...model.doors.map(d=>d.width)):null,communityCost:cost.expected*doc.community.households+(doc.community.sharedAllowanceInr??0)}
}
