import type {BuildingModel} from '../buildingModel.ts'
import type {FacadeZone} from './proceduralTypes.ts'
import type {FacadeDesign} from '../../model/facadeDesign.ts'
import {facadeDesignSchema,FACADE_DESIGNS,type FacadeRecipe} from '../../model/facadeDesign.ts'
import {makeRng,fnv} from '../massing/rng.ts'
import {uncoveredRects} from '../planner/projections.ts'
import {specificationMaterials,resolveSpecification} from '../../cost/catalogue.ts'
import type {Brief} from '../../model/brief.ts'
import {quantityRules} from '../../cost/data/quantityRules.ts'
import type {CoveredOutdoorModel} from '../coveredOutdoor.ts'

export type FacadePart={id:string;zoneId:string;floorId:string;side:FacadeZone['side'];fixed:number;
 sourceStyle?:FacadeRecipe;
 u:number;z:number;w:number;h:number;offset:number;depth:number;material:string;
 /** A convex profile in local wall coordinates, for rounded/angled solids. */
 profile?:[number,number][];
 bounds:{x:number;y:number;z:number;w:number;d:number;h:number}}
export type FacadeVariation={version:1;signature:string;sourcePlanId:string;configuration:FacadeDesign;
 styles?:FacadeRecipe[];
 parts:FacadePart[];notes:string[];materials:Record<string,{color:string;roughness:number;metalness:number;texture?:string;tileSizeM:number}>}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v))
const hit=(a:FacadePart['bounds'],b:FacadePart['bounds'])=>Math.min(a.x+a.w,b.x+b.w)>Math.max(a.x,b.x)+1&&Math.min(a.y+a.d,b.y+b.d)>Math.max(a.y,b.y)+1&&Math.min(a.z+a.h,b.z+b.h)>Math.max(a.z,b.z)+1
export function facadeOpeningKeepouts(b:BuildingModel):FacadePart['bounds'][] {
 return [...b.doors,...b.windows].map(o=>{
  const f=b.floors.find(f=>f.id===o.floorId)!,limits=f.openingLimits??quantityRules.openingLimits
  const door=o.kind!=='window',horizontal=o.orient==='h',margin=door?250:160,normal=door?1200:700
  const z=f.elevationMm+(door?0:o.sill??limits.defaultSillMm)-100
  const top=f.elevationMm+(o.head??(door?o.kind==='entry'?limits.entryHeadMm:limits.doorHeadMm:limits.windowHeadMm))+150
  return {x:o.at.x-(horizontal?o.width/2+margin:normal),y:o.at.y-(horizontal?normal:o.width/2+margin),z,
   w:horizontal?o.width+margin*2:normal*2,d:horizontal?normal*2:o.width+margin*2,h:top-z}
 })
}
/** Pure facade attachment recipes. Never mutates walls, windows, slabs or rooms. */
export function generateFacadeVariation(b:BuildingModel,zones:FacadeZone[],input:FacadeDesign,brief:Brief,covered?:CoveredOutdoorModel):FacadeVariation {
 const configuration=facadeDesignSchema.parse(input)
 if(configuration.facadeStyle==='MIXED')return mixFacadeVariations(b,zones,configuration,brief,covered)
 const {facadeStyle:style,facadeSeed:seed,facadeVariation:amount,materialPalette:palette}=configuration
 const rng=makeRng(seed,`${b.planId}|premium-facades-v1|${style}`),parts:FacadePart[]=[],notes:string[]=[]
 const keepouts=facadeOpeningKeepouts(b),env=b.plot.buildable
 const primary=resolveSpecification(brief,'exterior-paint').blenderMaterial
 const chosen=palette==='warm-timber'?'teak_wood':palette==='stone-metal'?'grey_stone':palette==='light-mineral'?'lime_plaster':primary
 const available=new Set(specificationMaterials.materials.map(m=>m.id))
 const select=(id:string)=>available.has(id)?id:primary
 const roles={wall:palette==='selected'?'wall':select(chosen),wood:select('teak_wood'),stone:select('grey_stone'),metal:select('metal_plate'),glass:'glass',green:'green'}
 const accent=makeRng(seed,`${style}|facade-material-combination-v1`).pick([roles.stone,roles.wood])
 const materials:FacadeVariation['materials']={}
 for(const id of Object.values(roles)){
  const m=specificationMaterials.materials.find(m=>m.id===id)
  // Existing curated material assets remain authoritative; colours are neutral tints.
  materials[id]={color:id==='glass'?'#abc3c2':id==='green'?'#62755a':id.includes('metal')?'#343a38':'#f0ede6',roughness:m?.roughness??(id==='green'?.75:.35),metalness:m?.metallic??(id.includes('metal')?.7:0),texture:m?.webFile?.replace(/^public/,'') ,tileSizeM:m?.tileSizeM??1}
 }
 const add=(zone:FacadeZone,u:number,z:number,w:number,h:number,depth:number,material:string,offset=0,profile?:[number,number][])=>{
  if(parts.length>=320||w<25||h<25||depth<=0||offset<0)return
  const horizontal=['N','S'].includes(zone.side),normal=['N','W'].includes(zone.side)?-1:1
  const wall=b.walls.find(w=>w.id===zone.wallId),face=wall?wall.thickness/2+8:0
  const fixed=zone.fixedMm+normal*(face+offset)
  const bounds={x:horizontal?u:fixed+(normal<0?-depth:0),y:horizontal?fixed+(normal<0?-depth:0):u,z,w:horizontal?w:depth,d:horizontal?depth:w,h}
  if(bounds.x<env.x||bounds.y<env.y||bounds.x+bounds.w>env.x+env.w||bounds.y+bounds.d>env.y+env.h||keepouts.some(k=>hit(bounds,k)))return
  // Keep balcony access and usable headroom open; skins remain shallow.
  if(depth+offset>160&&b.rooms.some(r=>r.outdoor&&r.floorId===zone.floorId&&hit(bounds,{x:r.rect.x,y:r.rect.y,z:zone.elevationMm,w:r.rect.w,d:r.rect.h,h:2200})))return
  parts.push({id:`FacadeDesign_${style}_${parts.length}`,sourceStyle:style,zoneId:zone.id,floorId:zone.floorId,side:zone.side,fixed:zone.fixedMm,u,z,w,h,offset:face+offset,depth,material,profile,bounds})
 }
 const walls=zones.filter(z=>z.wallId&&z.kind!=='VOID').sort((a,c)=>(a.side===b.orientation.roadPlanSide?-1:0)-(c.side===b.orientation.roadPlanSide?-1:0)||a.id.localeCompare(c.id))
 for(const zone of walls){
  const f=b.floors.find(f=>f.id===zone.floorId)!,length=zone.endMm-zone.startMm
  if(length<600)continue
  const inset=clamp(length*rng.range(.012,.045),45,180)*(.6+amount*.8)
  const end=zone.endMm-inset,start=zone.startMm+inset,width=end-start,H=zone.heightMm,Z=zone.elevationMm
  const wall=b.walls.find(w=>w.id===zone.wallId)!,face=wall.thickness/2+8
  const room=zone.side==='S'?env.y+env.h-zone.fixedMm:zone.side==='N'?zone.fixedMm-env.y:zone.side==='E'?env.x+env.w-zone.fixedMm:zone.fixedMm-env.x
  const depth=Math.min(room-face-10,clamp(width*(.025+amount*.025)*rng.range(.8,1.25),100,650))
  if(depth<24)continue
  const t=clamp(width*.028,65,160),top=Z+H-160
  // Full-height blank pier rectangles are derived by subtracting protected
  // openings in the wall plane. This uses the same rectangle subtraction as slabs.
  const holes=[...b.windows,...b.doors].filter(o=>o.floorId===f.id&&o.orient===(['N','S'].includes(zone.side)?'h':'v')&&Math.abs((o.orient==='h'?o.at.y:o.at.x)-zone.fixedMm)<2)
   .map(o=>({x:(o.orient==='h'?o.at.x:o.at.y)-o.width/2-250,y:Z,w:o.width+500,h:H}))
  const piers=uncoveredRects([{x:start,y:Z+180,w:width,h:H-400}],holes).filter(r=>r.w>=180)
  // Deep lightweight surrounds give whole volumes a different silhouette,
  // while subtracting each real aperture rather than covering the glazing.
  const skin=(u:number,w:number,z:number,h:number,d:number,material=roles.wall)=>{
   const cuts=[...b.windows,...b.doors].filter(o=>o.floorId===f.id&&o.orient===(['N','S'].includes(zone.side)?'h':'v')&&Math.abs((o.orient==='h'?o.at.y:o.at.x)-zone.fixedMm)<2).map(o=>{
    const lim=f.openingLimits??quantityRules.openingLimits,door=o.kind!=='window',margin=door?250:160
    const bottom=Z+(door?0:o.sill??lim.defaultSillMm)-100
    const head=Z+(o.head??(door?o.kind==='entry'?lim.entryHeadMm:lim.doorHeadMm:lim.windowHeadMm))+150
    return {x:(o.orient==='h'?o.at.x:o.at.y)-o.width/2-margin,y:bottom,w:o.width+margin*2,h:head-bottom}
   })
   for(const r of uncoveredRects([{x:u,y:z,w,h}],cuts))add(zone,r.x,r.y,r.w,r.h,d,material)
  }
  const band=(z=top,th=t,material=roles.wall,d=depth,u=start,w=width)=>add(zone,u,z,w,th,d,material)
  switch(style){
   case 'D01':
    if(zone.side===b.orientation.roadPlanSide&&(f.level>0||b.floors.length===1))skin(start,width,Z+180,H-360,Math.min(depth*.75,280))
    band(top-35,t*1.4);band(Z+H*.1,t*.75,accent,Math.min(depth,100),start+width*.18,width*.82)
    for(const r of piers.slice(rng.int(0,1),2))add(zone,r.x, Z+H*.1,Math.min(t,r.w),H*.81,depth,roles.wall)
    break
   case 'D02':
    band(top,t,roles.metal,depth,start+width*.16,width*.84)
    for(const r of piers.slice(0,2)){
     add(zone,r.x,r.y,Math.min(r.w,420),r.h,Math.min(depth,60),roles.glass)
     add(zone,r.x,r.y,t*.4,r.h,depth,roles.metal)
    }
    band(Z+H*.12,t*.6,roles.wall,depth*.6,start,width*.64)
    break
   case 'D03':
    skin(start,width,Z+H*.18,70,Math.min(depth*.6,140));skin(start,width,Z+H*.18+140,45,Math.min(depth*.45,110),roles.metal)
    band(top,t*.6);band(top-t*1.6,t*.4,roles.stone,depth*.5)
    band(Z+H*.16,t*.45,roles.metal,Math.min(depth,75))
    break
   case 'D04':{
    // A rounded outer corner on a deep fascia, rather than pill-shaped bars.
    const h=Math.min(300,H*.1),radius=h*.8,profile:[number,number][]=[[0,0],[width-radius,0]]
    for(let k=0;k<=12;k++){const a=-Math.PI/2+k*Math.PI/24;profile.push([width-radius+Math.cos(a)*radius,radius+Math.sin(a)*radius])}
    profile.push([width,h],[0,h]);add(zone,start,top-h+100,width,h,depth,roles.wall,0,profile)
    for(const r of piers.slice(0,2)){
     const w=Math.min(r.w,350),h=r.h,rad=Math.min(w*.6,180),curve:[number,number][]=[[0,0],[w,0],[w,h-rad]]
     for(let k=0;k<=12;k++){const a=k*Math.PI/24;curve.push([w-rad+Math.cos(a)*rad,h-rad+Math.sin(a)*rad])}curve.push([0,h])
     add(zone,r.x,r.y,w,h,depth*.85,roles.wall,0,curve)
    }
    break}
   case 'D05':{
    band(top,t*.7,roles.wood)
    const count=clamp(Math.floor(width/rng.range(350,650)),2,16)
    for(let j=0;j<count;j++)add(zone,start+j*width/count,top-120,55,100,depth,roles.wood)
    for(const r of piers.slice(0,1)){
     for(let x=r.x;x<r.x+Math.min(r.w,900)-40;x+=160)add(zone,x,r.y,35,r.h,Math.min(depth,90),roles.wood)
     const leaf=Math.min(130,r.w*.4)
     for(let j=0;j<5;j++){
      const x=r.x+Math.min(r.w-leaf,80+(j%2)*150),z=r.y+r.h*(.16+j*.15)
      add(zone,x,z,leaf,leaf*.65,Math.min(25,depth*.2),roles.green,Math.min(90,depth*.6),[[0,leaf*.3],[leaf*.45,0],[leaf,leaf*.35],[leaf*.55,leaf*.65]])
     }
    }
    break}
   case 'D06':
    if(zone.side===b.orientation.roadPlanSide){skin(start,width*.36,Z+180,H-400,Math.min(depth*.8,300));skin(start+width*.64,width*.36,Z+330,H-550,Math.min(depth*.6,240),accent)}
    band(top,t,roles.wall,depth,start,width*.42);band(top-150,t,roles.wood,depth*.7,start+width*.58,width*.42)
    for(const [i,r] of piers.slice(0,2).entries())add(zone,r.x,r.y,Math.min(r.w,500),r.h,Math.min(depth,140),i%2?roles.wood:accent)
    break
   case 'D07':
    for(const r of piers.slice(0,3)){
     const w=Math.min(r.w,450),h=r.h
     add(zone,r.x,r.y,w,h,depth,roles.metal,0,[[0,0],[w*.35,0],[w,h],[w*.65,h]])
    }
    add(zone,start,top-130,width,220,depth,roles.wall,0,[[0,0],[width,130],[width,220],[0,90]])
    break
   case 'D08':
    for(const r of piers.slice(0,2)){
     add(zone,r.x,r.y,r.w*.9,r.h,Math.min(depth,125),roles.stone)
     for(let z=r.y+350;z<r.y+r.h;z+=rng.int(280,450))add(zone,r.x,z,r.w*.9,30,Math.min(depth,140),roles.metal)
    }
    band(top,t*.45,roles.stone)
    break
   case 'D09':
    band(top,t*.55,roles.wall,depth);band(top-t*.8,t*.3,roles.metal,depth*.8)
    if(zone.kind==='ENTRANCE')for(const r of piers.slice(0,2))add(zone,r.x,r.y,Math.min(r.w,140),r.h,Math.min(depth,100),roles.wood)
    break
   case 'D10':
    for(const r of piers.slice(0,2)){
     const pitch=rng.int(170,250),w=Math.min(r.w,1400)
     for(let x=r.x;x<r.x+w-25;x+=pitch)add(zone,x,r.y,28,r.h,Math.min(depth,70),roles.wood)
     for(let z=r.y;z<r.y+r.h-25;z+=pitch)add(zone,r.x,z,w,28,Math.min(depth*.5,40),roles.metal)
    }
    band(top,t*.45,roles.metal)
    break
  }
 }
 if(style==='D09'&&covered?.sourcePlanId===b.planId){
  const ground=b.floors[0]
  for(const roof of covered.roofs.filter(r=>b.rooms.some(room=>room.id==='parking'&&(r.roomId===room.id||r.roomId===room.semanticId))))for(const r of roof.slabs){
   for(const side of ['N','S','E','W'] as const){
    const horizontal=side==='N'||side==='S'
    const zone:FacadeZone={id:`carport:${roof.id}:${side}`,kind:'ROOFLINE',floorId:ground.id,wallId:null,hostMassIds:[roof.id],roomId:'parking',side,fixedMm:side==='N'?r.y:side==='S'?r.y+r.h:side==='W'?r.x:r.x+r.w,startMm:horizontal?r.x:r.y,endMm:horizontal?r.x+r.w:r.y+r.h,elevationMm:ground.elevationMm,heightMm:ground.heightMm,openingIds:[]}
    add(zone,zone.startMm,ground.elevationMm+ground.heightMm-170,zone.endMm-zone.startMm,100,45,roles.metal)
   }
  }
 }
 if(style==='D05'&&!b.rooms.some(r=>r.outdoor&&r.id.startsWith('balcony')))notes.push('No balcony in this plan; garden detailing is adapted to wall-mounted timber shading.')
 if(style==='D09')notes.push(b.rooms.some(r=>r.id==='parking')?'Canopy detailing complements the existing supported parking; no structural span is added.':'No covered parking in this plan; canopy detailing is limited to the entrance.')
 notes.push('Lightweight facade attachments only. Fixings and wind loads require professional design; no occupied cantilever or new room is created.')
 if(!parts.length)notes.push('The available setbacks and openings leave no safe attachment area. The original house is retained.')
 return {version:1,signature:`facade-${fnv(JSON.stringify([b.planId,configuration,parts])).toString(16)}`,sourcePlanId:b.planId,configuration,parts,notes,materials}
}

/** One house, five or six recipes. A wall bay has one owner, so mixing never
 * stacks competing frames/screens on the same surface. Shared palette and
 * a bounded detail budget keep the result coherent and inexpensive to draw. */
function mixFacadeVariations(b:BuildingModel,zones:FacadeZone[],configuration:FacadeDesign,brief:Brief,covered?:CoveredOutdoorModel):FacadeVariation {
 const rng=makeRng(configuration.facadeSeed,`${b.planId}|facade-composition-v1`)
 const shuffled=FACADE_DESIGNS.map(d=>d[0])
 for(let i=shuffled.length-1;i>0;i--){const j=rng.int(0,i);[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]}
 const target=rng.int(5,6)
 let hosts=zones.filter(z=>z.wallId&&z.kind!=='VOID')
 // Small/simple houses can still have separate architectural bays; these
 // remain anchored to their original wall and obey the original keepouts.
 if(hosts.length<target)hosts=hosts.flatMap(z=>{
  const count=Math.max(1,Math.min(3,Math.floor((z.endMm-z.startMm)/1600)))
  return Array.from({length:count},(_,i)=>({...z,id:`${z.id}:mix-bay:${i}`,startMm:z.startMm+(z.endMm-z.startMm)*i/count,endMm:z.startMm+(z.endMm-z.startMm)*(i+1)/count}))
 })
 const candidates=new Map<FacadeRecipe,Map<string,FacadePart[]>>()
 const models=new Map<FacadeRecipe,FacadeVariation>()
 const preference=(id:FacadeRecipe,parts:FacadePart[])=>{
  const characteristic=id==='D02'?parts.some(p=>p.material==='glass'):id==='D04'||id==='D07'?parts.some(p=>p.profile):id==='D05'?parts.some(p=>p.material==='green'):id==='D09'?parts.some(p=>p.zoneId.startsWith('carport:')):parts.length>=3
  return (characteristic?1000:0)+Math.min(parts.length,30)
 }
 const owner=new Map<string,FacadeRecipe>()
 const match=(style:FacadeRecipe,visited:Set<string>):boolean=>{
  const groups=[...candidates.get(style)!].sort((a,c)=>preference(style,c[1])-preference(style,a[1])||a[0].localeCompare(c[0]))
  for(const [zone] of groups){
   if(visited.has(zone))continue;visited.add(zone)
   const previous=owner.get(zone)
   if(!previous||match(previous,visited)){owner.set(zone,style);return true}
  }
  return false
 }
 const selected:FacadeRecipe[]=[]
 for(const style of shuffled){
  const model=generateFacadeVariation(b,hosts,{...configuration,facadeStyle:style},brief,covered)
  models.set(style,model)
  const groups=new Map<string,FacadePart[]>()
  for(const p of model.parts){const group=groups.get(p.zoneId)??[];group.push(p);groups.set(p.zoneId,group)}
  candidates.set(style,groups)
  if(match(style,new Set()))selected.push(style)
  if(selected.length===target)break
 }
 const reserved=[...owner].map(([zone,style])=>({zone,style,parts:candidates.get(style)!.get(zone)!}))
 const counts=new Map(selected.map(id=>[id,1]))
 const extra:{zone:string;style:FacadeRecipe;parts:FacadePart[]}[]=[]
 const remaining=[...new Set(selected.flatMap(id=>[...candidates.get(id)!.keys()]))].filter(zone=>!owner.has(zone))
 for(const zone of remaining){
  const eligible=selected.filter(id=>candidates.get(id)!.has(zone)).map(id=>({id,weight:(counts.get(id)??0)+rng.next()*.7})).sort((a,c)=>a.weight-c.weight)
  if(!eligible.length)continue
  const style=eligible[0].id;counts.set(style,(counts.get(style)??0)+1)
  extra.push({zone,style,parts:candidates.get(style)!.get(zone)!})
 }
 const parts:FacadePart[]=[]
 // Reserve a representative bay for every contributor before filling the
 // rest. Whole extra bays are omitted if the existing 320-part budget is full.
 for(const group of reserved){
  const allowance=Math.floor(320/Math.max(1,selected.length))
  const stride=Math.max(1,Math.ceil(group.parts.length/allowance))
  for(let i=0;i<group.parts.length;i+=stride){const p=group.parts[i];parts.push({...p,id:`FacadeMix_${group.style}_${parts.length}`})}
 }
 for(const group of extra)if(parts.length+group.parts.length<=320)for(const p of group.parts)parts.push({...p,id:`FacadeMix_${group.style}_${parts.length}`})
 const styles=selected.filter(id=>parts.some(p=>p.sourceStyle===id))
 const materials=Object.assign({},...styles.map(id=>models.get(id)!.materials)) as FacadeVariation['materials']
 const notes=['Lightweight facade details are distributed across the house; openings, balcony access and the structural layout stay unchanged.']
 if(styles.length<5)notes.push('This constrained facade has fewer compatible attachment bays; unsafe details are omitted.')
 notes.push('Fixings and wind loading require professional design. No new occupied cantilever or structural span is added.')
 return {version:1,sourcePlanId:b.planId,configuration,styles,parts,materials,notes,signature:`facade-${fnv(JSON.stringify([b.planId,configuration,parts])).toString(16)}`}
}
