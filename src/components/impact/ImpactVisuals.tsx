import {useMemo,useState} from 'react'
import {FloorDrawing} from '@/lib/draw/FloorDrawing.tsx'
import type {ImpactSummary} from '@/lib/impact/summary.ts'
import type {Design} from '@/lib/engine/types.ts'
import type {Brief} from '@/lib/model/brief.ts'
import type {CostEstimate} from '@/lib/cost/index.ts'
import type {ImpactDocument} from '@/lib/impact/schema.ts'
import {buildImpactSummary} from '@/lib/impact/summary.ts'
import {translate as t} from '@/lib/i18n/index.ts'
import {button,type ImpactView} from './presentation.ts'
import {DiagramDeck,type DiagramChoice} from './DiagramDeck.tsx'
import {SvgHouseCrossSection} from './charts/SvgHouseCrossSection.tsx'
import {SvgImpactScoreRing} from './charts/SvgImpactScoreRing.tsx'
import {SvgWaterfallBar} from './charts/SvgWaterfallBar.tsx'
import {SvgCarbonDonut} from './charts/SvgCarbonDonut.tsx'
import {SvgDumbbellCompare} from './charts/SvgDumbbellCompare.tsx'
import {SvgWaterComboChart} from './charts/SvgWaterComboChart.tsx'
import {SvgCisternGauge} from './charts/SvgCisternGauge.tsx'
import {SvgRadialGauge} from './charts/SvgRadialGauge.tsx'
import {SvgThermalCutaway} from './charts/SvgThermalCutaway.tsx'
import {SvgAreaLine} from './charts/SvgAreaLine.tsx'
import {SvgRampElevation} from './charts/SvgRampElevation.tsx'
import {SvgBarCompare} from './charts/SvgBarCompare.tsx'

type Props={view:ImpactView;design:Design;brief:Brief;cost:CostEstimate;doc:ImpactDocument}
export function ImpactVisuals({view,design,brief,cost,doc}:Props){
 const summary=useMemo(()=>buildImpactSummary({design,brief,cost,document:{...doc,water:{...doc.water,rainfallMm:null}},cityOverride:cost.pricingContext?.location.city}),[design,brief,cost,doc])
 const {affordability:a,water:w,climate:c,accessibility:access}=summary
 const palette=['#677e74','#7c8e9d','#a28d76','#a6aaa0','#737675','#bbb3a7']
 const groups=cost.tradeTotals.filter(g=>g.amount>0).sort((a,b)=>b.amount-a.amount).slice(0,6).map(g=>({label:g.trade,currentVal:g.amount,swappedVal:Math.max(0,g.amount-a.ecoSwaps.filter(s=>s.group===g.trade).reduce((n,s)=>n+s.rupeeSaving,0)),unit:'₹'}))
 const latest=new Map<string,ImpactDocument['pilots'][number]>()
 for(const p of doc.pilots){const key=p.householdCode.trim().toLowerCase(),previous=latest.get(key);if(!previous||p.date>=previous.date)latest.set(key,p)}
 const pilots=[...latest.values()].filter(p=>p.stage==='supported'&&p.evidence.trim()&&p.sameScope&&p.baselineCostInr!==null&&p.actualCostInr!==null)
 const house=<SvgHouseCrossSection roofAreaM2={c.roofAreaM2} solarKw={c.solar.solarCapacityKw} annualHarvestL={w.annualHarvestL} annualHarvestCoverageDays={w.annualHarvestCoverageDays} tankAutonomyDisplay={w.tankAutonomyDisplay} heatCutWatts={c.heatCutWatts} hasCoolRoof={c.coolRoofU<c.standardRoofU} hasRamp={access.ramp.status==='pass'} rampRatio={access.ramp.gradientRatio??12} ventilationPathsCount={c.ventilationRoutesCount}/>
 const score=<SvgImpactScoreRing scores={summary.scores}/>
 const costs=<SvgBarCompare title="Cost by construction trade" groups={groups} currentLabel="Current estimate" swappedLabel="With alternatives"/>
 const choices:DiagramChoice[]=view==='overview'?[
  {id:'systems',label:'House systems',note:'Explore water, solar, ventilation and access in a concept illustration of your home.',content:house},
  {id:'profile',label:'Impact profile',note:'Review the assessment pillars and the inputs behind each score.',content:score},
 ]:view==='affordability'?[
  {id:'budget',label:'Budget balance',note:'Compare your target budget, current estimate and catalogue alternatives.',content:<SvgWaterfallBar budget={a.budget} currentCost={a.costExpected} swappedCost={a.costAfterSwaps} totalSavings={a.rupeeSavings} onEditBudget={()=>{const panel=document.getElementById('impact-budget-input');if(panel){panel.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});panel.querySelector('input')?.focus({preventScroll:true})}}}/>},
  {id:'trades',label:'Trade breakdown',note:'Select a construction trade to inspect its current and alternative costs.',content:costs},
  {id:'carbon',label:'Material footprint',note:'Illustrative material factors; documented carbon evidence is managed separately.',content:<SvgCarbonDonut items={a.carbonDonut.items.map((item,i)=>({...item,color:palette[i%palette.length],percentage:a.carbonDonut.totalKg>0?item.kgCo2e/a.carbonDonut.totalKg*100:0}))} totalKg={a.carbonDonut.totalKg}/>},
  {id:'compare',label:'Before & after',note:'Estimated cost and illustrative carbon effects of material alternatives.',content:<SvgDumbbellCompare baselineCost={a.costExpected} swappedCost={a.costAfterSwaps} baselineCarbonKg={a.carbonCompare.baselineKg} swappedCarbonKg={a.carbonCompare.afterSwapsKg}/>},
 ]:view==='water'?[
  {id:'annual',label:'Seasonal balance',note:'An annual benchmark scenario. Your entered rainfall event is shown separately in the summary.',content:<SvgWaterComboChart monthly={w.monthlyBalance} tankCapacityL={w.tankCapacityL??10000} annualHarvestL={w.annualHarvestL} tankerTripsSaved={0} tankerSavingsInr={0}/>},
  {id:'storage',label:'Tank & demand',note:'Scenario storage and full-tank supply; calculated illustrations, not sensor readings.',content:<div className="grid min-w-0 gap-3 sm:grid-cols-2"><SvgCisternGauge collectedLitres={w.monthlyBalance.at(-1)?.tankLevelL??0} capacityLitres={w.tankCapacityL??10000} dailyDemandLitres={w.dailyDemandL}/><SvgRadialGauge label="Full tank supply" value={w.tankAutonomyDays??(w.dailyDemandL>0?(w.tankCapacityL??10000)/w.dailyDemandL:0)} unit="Days" color="#677e74" sublabel="Scenario storage divided by daily demand"/></div>},
 ]:view==='climate'?[
  {id:'roof',label:'Roof heat flow',note:'Compare conduction using your roof area, U-values and temperature difference.',content:<SvgThermalCutaway className="impact-thermal" roofAreaM2={doc.climate.areaM2??cost.quantities.roofArea} areaBasis={doc.climate.areaM2===null?'From current plan':'Entered roof area'} standardU={doc.climate.currentRoofU} coolRoofU={doc.climate.proposedRoofU} deltaT={doc.climate.temperatureDifferenceK} source={doc.climate.source} onEditInputs={()=>{const panel=document.getElementById('roof-comparison-inputs') as HTMLDetailsElement|null;if(panel){panel.open=true;panel.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});panel.querySelector('input')?.focus({preventScroll:true})}}}/>},
  {id:'solar',label:'Solar potential',note:'Illustrative roof-area scenario. Applied solar quantities and costs remain in Finishes & Cost.',content:<SvgAreaLine title="Monthly solar potential" data={c.solar.monthlyGeneration} unit="kWh" color="#a28d76" primaryLabel="Scenario generation"/>},
 ]:view==='accessibility'?[
  {id:'plan',label:'Door access plan',note:'Switch floors to locate recorded doors. Opening dimensions are in millimetres.',content:<AccessPlanDiagram design={design} doors={access.doors}/>},
  {id:'ramp',label:'Entrance ramp',note:'Review the entry rise, ramp run and gradient from the current design.',content:<SvgRampElevation ramp={access.rampModel}/>},
  {id:'doors',label:'Opening widths',note:'Compare plan openings with the concept reference. Confirm installed clear widths on site.',content:<SvgBarCompare title="Door widths along the entrance route" currentLabel="Plan opening" swappedLabel="Concept review reference" groups={access.routeDoors.slice(0,8).map(d=>({label:d.roleLabel,currentVal:d.width,swappedVal:900,unit:'mm'}))}/>},
 ]:view==='community'?[
  {id:'costs',label:'Group costs',note:'Repeated home estimates plus the entered shared-services allowance.',content:<SvgBarCompare title="Community cost comparison" currentLabel="One home" swappedLabel={`${doc.community.households} homes + shared services`} groups={[{label:'Concept estimate',currentVal:cost.expected,swappedVal:cost.expected*doc.community.households+(doc.community.sharedAllowanceInr??0),unit:'₹'}]}/>},
  ...(pilots.length?[{id:'pilots',label:'Pilot costs',note:'Comparable user-recorded baseline and actual costs.',content:<SvgBarCompare title="Recorded pilot costs" currentLabel="Baseline" swappedLabel="Actual" groups={pilots.slice(0,8).map(p=>({label:p.householdCode,currentVal:p.baselineCostInr!,swappedVal:p.actualCostInr!,unit:'₹'}))}/>}]:[]),
  {id:'process',label:'Planning flow',note:'From a repeatable prototype to recorded community outcomes.',content:<FlowDiagram title="Community planning" steps={['House prototype','Shared services','Local review','Pilot outcomes']}/>},
 ]:view==='all'?[
  {id:'profile',label:'Impact profile',note:'Assessment pillars and their calculation basis.',content:score},
  {id:'systems',label:'House systems',note:'Concept illustration of the systems considered in your design.',content:house},
  {id:'costs',label:'Cost summary',note:'Compare the displayed construction trade costs and alternatives.',content:costs},
 ]:[]
 return <DiagramDeck key={view} choices={choices}/>
}

function FlowDiagram({title,steps}:{title:string;steps:string[]}){
 return <div className="rounded border border-line bg-bg-raised p-4"><h3 className="font-display text-base">{t(title)}</h3><ol className="mt-4 grid gap-2 sm:grid-cols-2">{steps.map((step,i)=><li key={step} className="flex items-center gap-3 rounded border border-line bg-bg p-3"><span className="font-mono text-[10px] text-ink-faint">0{i+1}</span><span className="text-xs text-ink-dim">{t(step)}</span></li>)}</ol></div>
}

function AccessPlanDiagram({design,doors}:{design:Design;doors:ImpactSummary['accessibility']['doors']}){
 const [level,setLevel]=useState(0)
 const floor=design.floors.find(f=>f.level===level)??design.floors[0],model=design.model
 const vb=`-3400 -1800 ${model.plot.width+5200} ${model.plot.depth+5200}`
 return <div className="rounded border border-line bg-bg-raised p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-display text-base">{t('Door access diagram')}</h3><div className="flex flex-wrap gap-2">{design.floors.map(f=><button key={f.level} className={`${button} ${floor.level===f.level?'bg-bg-inset':''}`} aria-pressed={floor.level===f.level} onClick={()=>setLevel(f.level)}>{t(f.level===0?'Ground floor':`Floor ${f.level}`)}</button>)}</div></div><div className="relative mt-3 h-[260px] w-full sm:h-[300px]"><FloorDrawing floor={floor} model={model} theme="paper"/><svg aria-label={t('Recorded doorway positions and opening widths')} role="img" viewBox={vb} className="pointer-events-none absolute inset-0 h-full w-full">{doors.filter(d=>d.floorId===(floor.prefix??`L${floor.level}`)).map(d=><g key={d.id} transform={`translate(${d.at.x},${d.at.y})`}><title>{`${d.roleLabel}: ${d.width} mm`}</title><circle r={d.isRouteDoor?150:95} fill={d.isRouteDoor?'#677e74':'#9ca6ac'} stroke="white" strokeWidth={30}/><rect x={-300} y={160} width={600} height={230} fill="white" stroke="#c5cbc6"/><text y={325} textAnchor="middle" fontSize={170} fill="#505050">{d.width}</text></g>)}</svg></div><p className="mt-2 text-xs text-ink-faint">{t('Plan opening widths in mm · verify installed clear widths on site.')}</p></div>
}
