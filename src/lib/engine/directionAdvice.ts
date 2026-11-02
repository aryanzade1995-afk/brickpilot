import type {Design} from './types.ts'

export function directionEvidence(designs:Design[]){
 const data=designs.map(design=>{
  const rooms=design.floors.flatMap(f=>f.rooms).filter(r=>!r.outdoor)
  const circulation=rooms.filter(r=>/corridor|passage|lobby|stair/i.test(`${r.id} ${r.name}`)).reduce((n,r)=>n+r.rect.w*r.rect.h/1e6,0)
  const ground=design.floors.find(f=>f.level===0)
  const groundBeds=ground?.rooms.filter(r=>!r.outdoor&&/bed|guest|parents/i.test(`${r.id} ${r.name}`)).length??0
  const plot=design.model.plot.width*design.model.plot.depth/1e6
  const open=Math.max(0,Math.min(100,(1-design.coveredFootprintSqm/plot)*100))
  const courtyard=design.floors[0]?.courtyard
  const court=courtyard?Math.round(courtyard.w*courtyard.h/1e6):0
  const living=Math.round(Math.max(0,...rooms.filter(r=>/living|lounge/i.test(`${r.id} ${r.name}`)).map(r=>r.rect.w*r.rect.h/1e6)))
  return {court,living,id:design.id,built:Math.round(design.builtAreaSqm),open:Math.round(open),circulation:design.builtAreaSqm>0?Math.round(circulation/design.builtAreaSqm*100):0,groundBeds}
 })
 const extent=(key:'built'|'open'|'circulation'|'living')=>({min:Math.min(...data.map(d=>d[key])),max:Math.max(...data.map(d=>d[key]))})
 const relative=(value:number,key:'built'|'open'|'circulation'|'living',lower=false)=>{const {min,max}=extent(key);return max===min?.5:lower?(max-value)/(max-min):(value-min)/(max-min)}
 return data.map(d=>({...d,candidates:[
  {id:'outdoor',label:'Space outdoors',score:d.open>0?relative(d.open,'open'):0,reason:`${d.open}% of the plot remains outside the covered ground footprint.`,tradeoff:'Outdoor area still needs a landscape and access layout.'},
  {id:'compact',label:'Compact building',score:d.built>0?relative(d.built,'built',true):0,reason:`${d.built} m² of built area across the planned floors.`,tradeoff:'Compare room sizes before choosing a smaller building.'},
  ...(d.groundBeds>0?[{id:'access',label:'Living on the ground floor',score:Math.min(1,d.groundBeds/2),reason:`${d.groundBeds} bedroom${d.groundBeds===1?'':'s'} on the ground floor.`,tradeoff:'Door clearances and the entrance route still need an access review.'}]:[]),
  ...(d.court>0?[{id:'court',label:'Open courtyard',score:1,reason:`A ${d.court} m² open courtyard at the centre of the ground floor.`,tradeoff:'A court uses buildable area and needs rainwater drainage.'}]:[]),
  ...(d.living>0?[{id:'living',label:'Living room space',score:relative(d.living,'living'),reason:`The largest living or family lounge measures ${d.living} m².`,tradeoff:'Check the furniture layout and routes through this room.'}]:[]),
  {id:'circulation',label:'Direct room connections',score:relative(d.circulation,'circulation',true),reason:`${d.circulation}% of built area is allocated to stairs, corridors and lobbies.`,tradeoff:'Less circulation area does not guarantee accessible movement.'},
 ]}))
}
export type DirectionEvidence=ReturnType<typeof directionEvidence>[number]
