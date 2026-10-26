import type {Brief} from '../model/brief.ts'
import type {Piece} from '../interior/layout.ts'
import type {AssetBox,WalkthroughAppearancePayload} from '../walkthrough/delivery.ts'
import {interiorAsset,selectedInteriorModel,type ModelCategory} from './catalogue.ts'
import type {Look} from '../three/dressRoom.ts'
import type {Rect} from '../geometry.ts'
type V3=[number,number,number]
export type InteriorModelInstance={id:string;assetId:string;assetRevision:string;roomId:string;floorId:string;position:V3;size:V3;rotation:number;scale:V3;color?:string;hardwareColor?:string;materialColors?:Record<string,string>;finish?:Look;replaces:string[];sourceProduct?:string}
const pieceCategory:Partial<Record<Piece['type'],ModelCategory>>={'sofa':'sofa','bed':'bed','armchair':'armchair','coffee-table':'coffee-table','dining-table':'dining-table','dining-chair':'dining-chair','chair':'dining-chair','wardrobe':'wardrobe','nightstand':'nightstand','side-table':'nightstand','pendant':'lamp','table-lamp':'lamp'}
/** Replaces only existing appearance parts. The current placer remains the
 * authority: no new furniture positions, walls or openings are introduced. */
export function roomInteriorModels(brief:Brief,roomId:string,finishRoomId:string,parts:AssetBox[],pieces:Piece[],fin:WalkthroughAppearancePayload['specifications'][number]['finishes'],bindings:Record<string,Look>,rect:Rect):InteriorModelInstance[]{
 const models:InteriorModelInstance[]=[],used=new Set<string>()
 function add(category:ModelCategory,group:AssetBox[],rotation=0,compatible?:string[],color?:string,anchor:'floor'|'top'='floor',fitEnvelope=false){
  group=group.filter(p=>!used.has(p.id));if(!group.length)return
  const choice=selectedInteriorModel(brief,category,finishRoomId)
  if(choice==='procedural')return
  const fallback=compatible?.[0]??category,asset=interiorAsset(choice==='auto'||compatible&&!compatible.includes(choice)?fallback:choice)
  if(!asset)return
  // Work in the model's rotated frame so E/W placements retain their shape.
  const c=Math.cos(rotation),s=Math.sin(rotation),xs:number[]=[],ys:number[]=[],zs:number[]=[]
  for(const p of group)for(const dx of [-1,1])for(const dy of [-1,1])for(const dz of [-1,1]){
   const a=Math.cos(p.rotation),b=Math.sin(p.rotation),lx=dx*p.size[0]/2,lz=dz*p.size[2]/2
   const x=p.position[0]+a*lx+b*lz,z=p.position[2]-b*lx+a*lz
   xs.push(c*x-s*z);zs.push(s*x+c*z);ys.push(p.position[1]+dy*p.size[1]/2)
  }
  const lo=[Math.min(...xs),Math.min(...ys),Math.min(...zs)],hi=[Math.max(...xs),Math.max(...ys),Math.max(...zs)]
  const available=hi.map((n,i)=>n-lo[i]) as V3
  if(available.some(n=>n<.005))return
  const uniform=Math.min(...available.map((n,i)=>n/asset.sizeM[i]))
  const scale:V3=fitEnvelope?available.map((n,i)=>n/asset.sizeM[i]) as V3:[uniform,uniform,uniform],size=asset.sizeM.map((n,i)=>n*scale[i]) as V3
  const x=(lo[0]+hi[0])/2,z=(lo[2]+hi[2])/2
  const position:V3=[c*x+s*z,anchor==='top'?hi[1]-size[1]:lo[1],-s*x+c*z]
  const sourceProduct=fin.specifications.find(p=>p.item===({fan:'fans',toilet:'sanitary',basin:'bath-basin',exhaust:'electrical-exhaust','kitchen-sink':'kitchen-sink','kitchen-base':'kitchen-cabinets','kitchen-upper':'kitchen-cabinets'} as Record<string,string>)[category])?.name
  const hardwareColor=category==='basin'||category==='toilet'?fin.fittings?.finish==='gold'?'#ba9856':fin.fittings?.finish==='black'?'#151515':'#bdc2c5':category==='kitchen-sink'?fin.kitchenSink?.finish==='black'?'#151515':fin.kitchenSink?.finish==='white'?'#f5f3ef':'#bdc2c5':undefined
  const finish=category==='kitchen-base'||category==='kitchen-upper'?bindings[group[0].binding]:undefined
  const woodPart=group.find(p=>p.sourceIds.some(id=>/frame|leg|body|headboard|plinth/.test(id)))
  const wood=woodPart?bindings[woodPart.binding]?.color??'#79543B':'#79543B'
  const fabric=color??'#547C79',accent='#B26B4E'
  const materialColors:Record<string,string>=category==='dining-chair'?{'Table-Cross_NONE':wood,'Table-Cross':wood,'Cushion1':fabric,'Cushion-Ties':fabric}:category==='dining-table'?{'Table-Cross':wood}:category==='sofa'?{SofaFrame:wood}:category==='bed'?{leftPillow:accent,rightPillow:accent,bianco:accent}:category==='armchair'?{modern_arm_chair_01_pillow:fabric}:category==='lamp'?{'Ceiling-light-fitting':'#7E5F3D','Lamp-cable':'#343734','Lamp-inside':'#C89D5F'}:{}
  models.push({id:`model:${group[0].id}`,assetId:asset.id,assetRevision:asset.sha256,roomId,floorId:group[0].floorId,position,size,rotation,scale,color,hardwareColor,finish,materialColors,replaces:group.map(p=>p.id),sourceProduct})
  group.forEach(p=>used.add(p.id))
 }
 for(const p of pieces){
  const category=pieceCategory[p.type];if(!category)continue
  const group=parts.filter(b=>b.sourceIds.some(id=>id===p.id||id.startsWith(p.id+'-')))
  const angle={S:0,E:Math.PI/2,N:Math.PI,W:Math.PI*1.5}[p.face]
  const fabric=group.find(b=>b.sourceIds.some(id=>id.includes('-seat')))
  const linen=group.find(b=>b.sourceIds.some(id=>id.includes('-duvet')))
  add(category,group,Math.PI-angle,undefined,p.type==='sofa'&&fabric?bindings[fabric.binding]?.color:p.type==='bed'&&linen?bindings[linen.binding]?.color:undefined)
 }
 const match=(re:RegExp)=>parts.filter(p=>p.sourceIds.some(id=>re.test(id)))
 const facing=(group:AssetBox[])=>{
  if(!group.length)return 0
  const x=group[0].position[0],z=group[0].position[2]
  return [[Math.abs(z+rect.y/1000),Math.PI],[Math.abs(z+(rect.y+rect.h)/1000),0],[Math.abs(x-rect.x/1000),Math.PI/2],[Math.abs(x-(rect.x+rect.w)/1000),-Math.PI/2]].sort((a,b)=>a[0]-b[0])[0][1]
 }
 // These are the already-placed selected fixtures, never a generic bathroom kit.
 if(fin.fan)add('fan',match(/^fan-(?:rod|hub|blade)/),0,['fan'],fin.fan.profile?.color,'top')
 if(fin.exhaust){const g=match(/^exhaust$/);add('exhaust',g,facing(g),['exhaust'],fin.exhaust.profile?.color)}
 const wc=fin.sanitary?.wc
 if(wc&&wc!=='indian'){const g=match(/-toilet(?:-|$)|-selected-cistern$|-flush-plate$/);add('toilet',g,facing(g),wc==='wall'?['toilet-wall']:['toilet-modern','toilet'],fin.sanitary?.profile?.color)}
 if(fin.basin){const g=match(/-basin(?:-|$)/);add('basin',g,facing(g),['basin'],fin.basin.profile?.color)}
 if(fin.tub)add('bathtub',match(/-tub(?:-|$)|-bathtub(?:-|$)/),0,['bathtub'],fin.tub.profile?.color)
 if(fin.kitchenSink?.bowls===1)add('kitchen-sink',match(/-sink-(?:rim|bowl|drain|\d)|-faucet-/),0,['kitchen-sink'])
 // Countertop/sink geometry is never part of a cabinet replacement. Preserve
 // glass and handleless product choices with their matching standard fronts.
 if(fin.cabinets&&!fin.cabinets.glass&&!fin.kitchenHardware?.handleless){
  for(const body of match(/-counter\d+-module-\d+$/)){
   const id=body.sourceIds[0],m=id.match(/^(.*)-module-(\d+)$/)!
   const group=[body,...parts.filter(p=>p.sourceIds.some(s=>s.startsWith(`${m[1]}-front-${m[2]}-`)||s.startsWith(`${m[1]}-handle-${m[2]}-`)))]
   add('kitchen-base',group,facing([body]),fin.kitchenHardware?.drawers?['kitchen-drawers','kitchen-base']:['kitchen-base'],fin.cabinets.color,'floor',true)
  }
  for(const upper of match(/(?:-upper\d+|-wall-cabinet)-module-\d+$/))add('kitchen-upper',[upper],facing([upper]),['kitchen-upper'],fin.cabinets.color,'floor',true)
 }
 for(const hob of match(/-hob$/))add('kitchen-hob',[hob],facing([hob]),['kitchen-hob'])
 add('washing-machine',match(/-(?:washer|washing-machine)(?:-|$)/))
 return models
}
