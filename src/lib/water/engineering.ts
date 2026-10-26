import { waterConfigSchema, waterScenarioSchema, waterSignature, type WaterConfig, type WaterScenario, type WaterSensor } from './schema.ts'
import { z } from 'zod'

export type WaterCheck = { id: string; status: 'Pass'|'Warning'|'Fail'|'Not Checked'; itemId: string|null; reason: string; correction: string }
/** 1 mm over 1 m² = 1 litre. No assumed coefficient or climate input. */
export function rainfallYield(rainfallMm: number, areaM2: number, runoffCoefficient: number, collectionEfficiency: number) {
  if (![rainfallMm,areaM2,runoffCoefficient,collectionEfficiency].every(Number.isFinite) || Math.min(rainfallMm,areaM2,runoffCoefficient,collectionEfficiency)<0 || runoffCoefficient>1 || collectionEfficiency>1) throw new RangeError('Use nonnegative mm, m² and coefficients between 0 and 1.')
  const incident=rainfallMm*areaM2, runoff=incident*runoffCoefficient, collected=runoff*collectionEfficiency
  if(!Number.isFinite(incident))throw new RangeError('Rainfall volume exceeds the supported numeric range.')
  return {incidentLitres:incident,runoffLossLitres:incident-runoff,collectionLossLitres:runoff-collected,collectedLitres:collected}
}
export function tankStep(capacityLitres:number,previousLitres:number,inflowLitres:number,demandLitres:number) {
  if (![capacityLitres,previousLitres,inflowLitres,demandLitres].every(Number.isFinite)||Math.min(capacityLitres,previousLitres,inflowLitres,demandLitres)<0||previousLitres>capacityLitres) throw new RangeError('Invalid tank capacity, storage, inflow or demand.')
  if(!Number.isFinite(previousLitres+inflowLitres))throw new RangeError('Tank inflow exceeds the supported numeric range.')
  const available=Math.min(capacityLitres,previousLitres+inflowLitres), overflow=Math.max(0,previousLitres+inflowLitres-capacityLitres), served=Math.min(available,demandLitres)
  return {storageLitres:available-served,overflowLitres:overflow,servedLitres:served,unmetLitres:demandLitres-served}
}
export function validateWaterSystem(config:WaterConfig, current?:{sourcePlanId:string;roofSignature:string}):WaterCheck[] {
  const parsed=waterConfigSchema.safeParse(config)
  if(!parsed.success)return parsed.error.issues.map((e,i)=>({id:`invalid-input:${i}`,status:'Fail',itemId:null,reason:`${e.path.join('.')}: ${e.message}`,correction:'Correct this input before saving or simulating.'}))
  const c=parsed.data, checks:WaterCheck[]=[], nodes=new Map(c.components.map(n=>[n.id,n]))
  const add=(id:string,status:WaterCheck['status'],itemId:string|null,reason:string,correction='')=>checks.push({id,status,itemId,reason,correction})
  if(current&&(current.sourcePlanId!==c.sourcePlanId||current.roofSignature!==c.roofSignature)) add('roof-changed','Fail',null,'The house or roof changed. Saved placements are retained for review.','Review catchments and placements, then confirm the current roof.')
  if(!c.catchments.length)add('no-catchments','Not Checked',null,'No harvesting catchment configured.','Add a represented roof or a manually measured catchment.')
  for(const component of c.components)if(component.kind==='catchment'&&c.catchments.filter(a=>a.componentId===component.id).length!==1)add(`catchment-owner:${component.id}`,'Fail',component.id,'A catchment component must have exactly one area record.','Remove duplicated area records or attach the missing catchment.')
  for(const connection of c.connections) {
    const a=nodes.get(connection.from),b=nodes.get(connection.to)
    if(!a||!b||a.id===b.id){add(`connection:${connection.id}`,'Fail',connection.id,'Connection has a missing endpoint or connects to itself.','Select two existing distinct components.');continue}
    if(['outlet','recharge'].includes(a.kind)||b.kind==='catchment'||(a.kind==='tank'&&connection.kind!=='overflow')||(connection.kind==='overflow'&&!['tank','overflow'].includes(a.kind)))add(`direction:${connection.id}`,'Fail',connection.id,'Invalid component flow direction or connection type.','Collection flows to storage; tank overflow flows through overflow to an outlet or recharge pit.')
    if(!a.positionM||!b.positionM)add(`position:${connection.id}`,'Not Checked',connection.id,'A connection endpoint has no measured or configured position.','Place both components in metres.')
    else {
      const points=[a.positionM,...connection.viaM,b.positionM]
      if(points.some((p,i)=>i>0&&p[1]>points[i-1][1]+.001))add(`gravity:${connection.id}`,'Warning',connection.id,'The concept route rises against gravity; hydraulic grade and pumping are not established.','Review levels, losses and pump requirements with the designer.')
    }
    add(`structure:${connection.id}`,'Not Checked',connection.id,'Structural penetrations, drainage falls and access are not verified for this user-defined route.','Review each route against walls, beams, foundations and other services.')
  }
  for(const n of c.components) {
    const edges=c.connections.filter(e=>e.from===n.id)
    if(edges.length>1)add(`branch:${n.id}`,'Fail',n.id,'Flow splitting is not defined for this component.','Use one downstream connection; split systems into separate catchments.')
    if(!['catchment','outlet','recharge'].includes(n.kind)&&!c.connections.some(e=>e.to===n.id))add(`unfed:${n.id}`,'Warning',n.id,'This component is disconnected from upstream collection.','Connect it or remove the unused component.')
    if(!['outlet','recharge'].includes(n.kind)&&!edges.length)add(`dead-end:${n.id}`,'Not Checked',n.id,'A water path ends before a discharge destination.','Complete the downstream connection.')
    if(n.kind==='first_flush'&&n.diversionLitres===null)add(`flush:${n.id}`,'Not Checked',n.id,'First-flush diversion volume is unknown.','Enter litres diverted per explicitly marked rain event.')
    if(n.kind==='filter'&&n.efficiency===null)add(`filter:${n.id}`,'Not Checked',n.id,'Filter recovery efficiency is unknown.','Enter a sourced fraction; do not duplicate collection losses.')
    if(n.kind==='tank') {
      if(n.tankCapacityLitres===null||n.initialStorageLitres===null)add(`tank:${n.id}`,'Not Checked',n.id,'Tank capacity or initial storage is unknown.','Enter measured/design litres, including an explicit zero when empty.')
      else if(n.initialStorageLitres>n.tankCapacityLitres)add(`tank:${n.id}`,'Fail',n.id,'Initial storage exceeds capacity.','Correct storage or tank capacity.')
      const demand=c.demands.filter(d=>d.tankId===n.id)
      if(demand.length!==1||demand[0].dailyLitres===null)add(`demand:${n.id}`,'Not Checked',n.id,'One explicit daily demand is required per tank.','Enter litres/day; enter zero only for an explicit no-demand scenario.')
    }
    if(['recharge','outlet'].includes(n.kind)&&n.destinationApproved!==true)add(`approval:${n.id}`,'Warning',n.id,'The discharge destination is not verified as approved.','Confirm site suitability and local permission; no infiltration rate is assumed.')
    if(!['catchment','tank','outlet','recharge'].includes(n.kind)) {
      const upstream=c.catchments.filter(a=>{let id:string|undefined=a.componentId;const seen=new Set<string>();while(id&&!seen.has(id)){if(id===n.id)return true;seen.add(id);id=c.connections.find(e=>e.from===id)?.to}return false})
      if(c.designStorm.intensityMmH===null||!c.designStorm.source.trim()||n.capacityLps===null||!n.capacityBasis.trim()||!upstream.length||upstream.some(a=>a.areaM2===null||a.runoffCoefficient===null||a.collectionEfficiency===null))add(`capacity:${n.id}`,'Not Checked',n.id,'Peak flow requires sourced storm intensity (mm/h), upstream catchment factors and a sourced component rating; daily rainfall is insufficient.','Provide the missing design data. No code sizing is inferred.')
      else {const peak=upstream.reduce((sum,a)=>sum+c.designStorm.intensityMmH!*a.areaM2!*a.runoffCoefficient!*a.collectionEfficiency!/3600,0);add(`capacity:${n.id}`,peak>n.capacityLps?'Warning':'Pass',n.id,`Conservative upstream concept flow ${peak.toFixed(3)} L/s versus rated ${n.capacityLps} L/s. ${peak>n.capacityLps?'Rating is below entered peak demand.':'Entered rating covers this simple steady-flow comparison.'}`,'Review storm duration, head, inlet losses, pipe slopes and bypass behaviour with an engineer. This is not hydraulic approval.')}
    }
  }
  const globallyChecked=new Set<string>()
  for(const n of c.components){const seen=new Set<string>();let id:string|undefined=n.id;while(id&&!globallyChecked.has(id)){if(seen.has(id)){add(`loop:${n.id}`,'Fail',id,'A component connection loop is present.','Remove the circular connection.');break}seen.add(id);id=c.connections.find(e=>e.from===id)?.to}for(const item of seen)globallyChecked.add(item)}
  for(const demand of c.demands)if(nodes.get(demand.tankId)?.kind!=='tank')add(`orphan-demand:${demand.tankId}`,'Fail',demand.tankId,'Demand refers to a missing tank.','Select an existing storage tank.')
  for(const catchment of c.catchments) {
    if(nodes.get(catchment.componentId)?.kind!=='catchment')add(`source:${catchment.id}`,'Fail',catchment.id,'Catchment has no catchment component.','Assign the correct source component.')
    if([catchment.areaM2,catchment.runoffCoefficient,catchment.collectionEfficiency].some(v=>v===null))add(`input:${catchment.id}`,'Not Checked',catchment.id,'Area, runoff coefficient or collection efficiency is unknown.','Measure the roof and provide sourced coefficients.')
    const visited=new Set<string>(), kinds:string[]=[], path:string[]=[];let id:string|undefined=catchment.componentId
    while(id) {
      if(visited.has(id)){add(`cycle:${catchment.id}`,'Fail',id,'The water network contains a loop.','Remove the circular connection.');break}
      visited.add(id);path.push(id);const n=nodes.get(id);if(!n)break;kinds.push(n.kind)
      id=c.connections.find(e=>e.from===id)?.to
    }
    for(const kind of ['gutter','downpipe','first_flush','filter','tank'])if(!kinds.includes(kind))add(`missing:${catchment.id}:${kind}`,'Not Checked',catchment.id,`No ${kind.replace('_',' ')} connected downstream.`,'Complete and review the treatment/storage chain.')
    if(kinds.includes('tank')&&(!kinds.includes('overflow')||!['outlet','recharge'].includes(kinds.at(-1)??'')))add(`outfall:${catchment.id}`,'Not Checked',catchment.id,'Storage overflow has no complete route to a discharge destination.','Connect tank → overflow → approved outlet or recharge pit.')
    const sequence=['catchment','gutter','downpipe','first_flush','filter','tank','overflow']
    if(sequence.every(kind=>kinds.includes(kind))&&!sequence.every((kind,i)=>i===0||kinds.indexOf(kind)>kinds.indexOf(sequence[i-1])))add(`treatment-order:${catchment.id}`,'Fail',catchment.id,'Component order does not match the supported collection, diversion, filtration, storage and overflow sequence.','Correct the component order.')
    if(path.length&&kinds.at(-1)&&['outlet','recharge'].includes(kinds.at(-1)!))add(`connected:${catchment.id}`,'Pass',catchment.id,'A continuous concept route reaches a discharge destination. This is not engineering approval.')
  }
  return checks
}
const volume=z.number().finite().nonnegative()
export const waterSimulationSchema=z.object({version:z.literal(1),signature:z.string(),scenarioId:z.string(),status:z.enum(['complete','insufficient-information']),reasons:z.array(z.string()),days:z.array(z.object({
  date:z.iso.date(),rainfallMm:volume,incidentLitres:volume,runoffLossLitres:volume,collectionLossLitres:volume,treatmentLossLitres:volume,inflowLitres:volume,storageLitres:volume,servedLitres:volume,unmetLitres:volume,overflowLitres:volume,rechargeRoutedLitres:volume,balanceErrorLitres:z.number().finite(),
}))})
export type WaterSimulation=z.infer<typeof waterSimulationSchema>
export type SimulationDay=WaterSimulation['days'][number]
/** Topological volume propagation. Shared first-flush/filter devices process merged
 * inflow once. Tanks never send daily demand back into the collection network. */
export function simulateWater(config:WaterConfig,scenario:WaterScenario,capacityOverrides:Record<string,number>={}):WaterSimulation {
  const c=waterConfigSchema.parse(config),s=waterScenarioSchema.parse(scenario)
  const result:WaterSimulation={version:1,signature:waterSignature(c),scenarioId:s.id,status:'insufficient-information',reasons:[],days:[]}
  const checks=validateWaterSystem(c)
  result.reasons=checks.filter(x=>x.status==='Fail'||x.status==='Not Checked'&&!/^(structure:|position:|capacity:)/.test(x.id)).map(x=>x.reason)
  if(!c.components.some(n=>n.kind==='tank'))result.reasons.push('Add storage before simulating.')
  if(s.days.some(d=>d.rainfallMm===null))result.reasons.push('Daily rainfall is missing.')
  if(!s.days[0].eventStart)result.reasons.push('The first simulated day must explicitly start an event, including a dry initialization day.')
  if(Object.values(capacityOverrides).some(v=>!Number.isFinite(v)||v<0))throw new RangeError('Invalid comparison tank size')
  for(const n of c.components.filter(n=>n.kind==='tank'))if((capacityOverrides[n.id]??n.tankCapacityLitres??0)<(n.initialStorageLitres??0))result.reasons.push('Comparison capacity is below initial storage.')
  if(result.reasons.length)return result
  const nodes=new Map(c.components.map(n=>[n.id,n])), incoming=new Map(c.components.map(n=>[n.id,0]))
  for(const e of c.connections)incoming.set(e.to,(incoming.get(e.to)??0)+1)
  const order=[...incoming].filter(([,count])=>count===0).map(([id])=>id)
  for(let i=0;i<order.length;i++)for(const e of c.connections.filter(e=>e.from===order[i])){const count=incoming.get(e.to)!-1;incoming.set(e.to,count);if(count===0)order.push(e.to)}
  if(order.length!==nodes.size){result.reasons.push('Network contains a cycle.');return result}
  const storage=new Map(c.components.filter(n=>n.kind==='tank').map(n=>[n.id,n.initialStorageLitres!])), remainingFlush=new Map<string,number>()
  for(const day of s.days) {
    if(day.eventStart)remainingFlush.clear()
    const row:SimulationDay={date:day.date,rainfallMm:day.rainfallMm!,incidentLitres:0,runoffLossLitres:0,collectionLossLitres:0,treatmentLossLitres:0,inflowLitres:0,storageLitres:0,servedLitres:0,unmetLitres:0,overflowLitres:0,rechargeRoutedLitres:0,balanceErrorLitres:0}, amounts=new Map<string,number>()
    for(const catchment of c.catchments){const y=rainfallYield(day.rainfallMm!,catchment.areaM2!,catchment.runoffCoefficient!,catchment.collectionEfficiency!);row.incidentLitres+=y.incidentLitres;row.runoffLossLitres+=y.runoffLossLitres;row.collectionLossLitres+=y.collectionLossLitres;amounts.set(catchment.componentId,(amounts.get(catchment.componentId)??0)+y.collectedLitres)}
    const previous=[...storage.values()].reduce((a,b)=>a+b,0)
    let discharged=0
    for(const id of order){const n=nodes.get(id)!;let amount=amounts.get(id)??0
      if(n.kind==='first_flush'){const left=remainingFlush.get(id)??n.diversionLitres!,loss=Math.min(left,amount);amount-=loss;row.treatmentLossLitres+=loss;remainingFlush.set(id,left-loss)}
      if(n.kind==='filter'){const loss=amount*(1-n.efficiency!);amount-=loss;row.treatmentLossLitres+=loss}
      if(n.kind==='tank'){row.inflowLitres+=amount;const step=tankStep(capacityOverrides[id]??n.tankCapacityLitres!,storage.get(id)!,amount,c.demands.find(d=>d.tankId===id)!.dailyLitres!);storage.set(id,step.storageLitres);row.servedLitres+=step.servedLitres;row.unmetLitres+=step.unmetLitres;row.overflowLitres+=step.overflowLitres;amount=step.overflowLitres}
      if(n.kind==='recharge'){row.rechargeRoutedLitres+=amount;discharged+=amount}
      else if(n.kind==='outlet')discharged+=amount
      const edge=c.connections.find(e=>e.from===id);if(edge)amounts.set(edge.to,(amounts.get(edge.to)??0)+amount)
    }
    row.storageLitres=[...storage.values()].reduce((a,b)=>a+b,0)
    row.balanceErrorLitres=previous+row.incidentLitres-row.runoffLossLitres-row.collectionLossLitres-row.treatmentLossLitres-row.servedLitres-discharged-row.storageLitres
    if(Math.abs(row.balanceErrorLitres)>1e-6){result.reasons.push('Unaccounted water: inspect dead ends or unsupported tank routing.');result.days=[];return result}
    result.days.push(row)
  }
  result.status='complete';return waterSimulationSchema.parse(result)
}
export function sensorState(s:WaterSensor,now=Date.now()):'offline'|'invalid'|'stale'|'current' {
  if(!s.online)return 'offline'
  const date=Date.parse(s.recordedAt??''),expected={tank_level:'%',flow:'L/s',rainfall:'mm'}[s.type]
  if(s.value===null||!Number.isFinite(s.value)||s.value<0||s.type==='tank_level'&&s.value>100||s.unit!==expected||!Number.isFinite(date)||!/(Z|[+-]\d\d:\d\d)$/.test(s.recordedAt??'')||date>now+60000||!Number.isFinite(s.staleAfterMinutes)||s.staleAfterMinutes<=0)return 'invalid'
  return now-date>s.staleAfterMinutes*60000?'stale':'current'
}
