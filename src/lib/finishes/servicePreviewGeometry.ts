import { finishProduct } from './catalogue.ts'
import type { SpecItem, SpecOption } from '../cost/workspace.ts'
import type { PreviewPart } from './previewGeometry.ts'
const box=(size:PreviewPart['size'],at:PreviewPart['at'],extra:Partial<PreviewPart>={}):PreviewPart=>({size,at,...extra})
const chrome={color:'#d6dde2',metallic:.65,roughness:.20},white={color:'#f6f6f2',roughness:.12}
const cylinder=(r:number,h:number,at:PreviewPart['at'],extra:Partial<PreviewPart>={})=>box([r,r,h],at,{shape:'cylinder',...extra})
const sphere=(size:PreviewPart['size'],at:PreviewPart['at'],extra:Partial<PreviewPart>={})=>box(size,at,{shape:'sphere',...extra})
const shell=(size:PreviewPart['size'],at:PreviewPart['at'],square=1,extra:Partial<PreviewPart>={})=>box(size,at,{shape:'shell',squareness:square,profile:[[.01,0],[.32,.02],[.43,.18],[.49,.83],[.5,1],[.465,1],[.455,.87],[.37,.22],[.12,.14],[.01,.14]],...white,...extra})
const ring=(size:PreviewPart['size'],at:PreviewPart['at'],extra:Partial<PreviewPart>={})=>box(size,at,{shape:'shell',profile:[[.5,0],[.5,1],[.38,1],[.38,0],[.5,0]],...white,...extra})
/** Catalogue photos remain unmodified references. Models illustrate installation and component form. */
export function servicePreviewParts(item:Pick<SpecItem,'id'|'group'>,option:SpecOption):PreviewPart[]|undefined {
 const preview=finishProduct(option.finishProductId)?.preview
 if(!preview)return undefined
 const {model,variant:v,color,accent}=preview,ceramic={...white,color},metal={...chrome,color:accent}
 const p:PreviewPart[]=[]
 const faucet=(x=0,y=0,z=0,wall=false)=>{
  if(wall){
   const length=v===3?.66:.80
   p.push(v===3?box([.87,.28,.06],[x+.2,y,z-.08],metal):cylinder(.095,.04,[x,y,z-.08],{rotation:[Math.PI/2,0,0],...metal}),cylinder(.05,length,[x,y,z+length/2],{rotation:[Math.PI/2,0,0],...metal}),sphere([.10,.10,.10],[x,y,z+length],metal),cylinder(.05,.12,[x,y-.04,z+length],metal),cylinder(.08,.07,[x+.41,y,z-.03],{rotation:[Math.PI/2,0,0],...metal}),box([.04,.21,.06],[x+.41,y+.08,z+.04],metal))
   return
  }
  const tall=model==='faucet'&&v===4,body=tall?.78:.53,top=y+body/2,spout=model==='faucet-wall'&&v===3?.53:model==='faucet'&&v===2?.34:.44
  p.push(cylinder(.09,.08,[x,y-.25,z],metal),cylinder(v===2?.06:.07,body,[x,y+(tall?.13:0),z],metal),box([.13,.10,spout],[x,top+(tall?.13:0),z+spout*.37],metal),box([.055,.02,v===2?.18:.23],[x,top+.09+(tall?.13:0),z+.09],{rotation:[v===2?.18:.08,0,0],...metal}),cylinder(.047,.035,[x,top-.065+(tall?.13:0),z+spout*.77],metal))
  if(wall)p.push(box([.55,.2,.055],[x,y-.2,z-.12],metal))
 }
 if(model.startsWith('toilet-')){
  if(model==='toilet-indian'){
   p.push(box([2.2,.10,2.5],[0,-.53,0],{color:'#b7b4ac'}),shell([.76,.30,1.54],[0,-.37,0],.7,ceramic))
   for(const x of [-.60,.60]){p.push(box([.38,.08,1.54],[x,-.12,0],ceramic));for(let i=0;i<10;i++)p.push(box([.29,.01,.028],[x,-.073,-.58+i*.13],{color:'#dfdfda'}))}
   p.push(cylinder(.08,.03,[0,-.31,-.49],{color:'#4c4e4c'}),cylinder(.043,.15,[0,.015,-.82],metal))
  }else{
   const wall=model==='toilet-wall',w=1.05+v*.015,d=1.60-v*.035
   p.push(shell([w,.66,d],[0,wall?-.30:-.12,.05],.72,ceramic),ring([w+.01,.055,d+.01],[0,wall?.07:.25,.05],{squareness:.72,color:'#ffffff'}))
   if(wall)p.push(box([1.6,1.9,.16],[0,-.05,-.9],{color:'#d6d1c5'}),box([.43,.22,.028],[0,.56,-.80],metal),...[-.105,.105].map(x=>cylinder(.065,.02,[x,.56,-.774],{rotation:[Math.PI/2,0,0],...metal})))
   else{
    p.push(shell([.68,.64,.97],[0,-.72,-.18],.65,{...ceramic,profile:[[.01,0],[.34,0],[.45,.08],[.49,.75],[.41,1],[.01,1]]}))
    p.push(box([1.00,v===2?.78:.69,.41],[0,.55,-.65],ceramic),box([1.04,.06,.45],[0,.94,-.65],ceramic),cylinder(.065,.018,[0,.977,-.65],metal))
   }
  }
  return p
 }
 if(model.startsWith('basin-')){
  const pedestal=model==='basin-pedestal',square=/square|rectangle|undermount/.test(model),width=model==='basin-square'?1.35:1.95,depth=model==='basin-square'?1.35:1.23
  if(pedestal){
   p.push(shell([1.02,1.80,1.03],[0,-.05,0],.23,{...ceramic,profile:[[.01,0],[.45,0],[.49,.035],[.49,1],[.42,1],[.40,.87],[.10,.84],[.01,.84]]}),cylinder(.045,.02,[0,.57,0],metal))
   faucet(0,.72,-.39)
   return p
  }
  else{
   p.push(box([2.3,.70,1.45],[0,-.72,0],{color:v===2?'#42484a':v===3?'#d5cec3':'#765b42',roughness:.4}),box([2.35,.085,1.48],[0,-.33,0],{color:'#e7e5df'}))
   for(const y of [-.58,-.86])p.push(box([2.12,.022,.035],[0,y,.73],{color:'#333534'}))
   for(const x of [-.62,.62])p.push(box([.27,.025,.035],[x,-.52,.77],metal))
  }
  p.push(shell([width,.40,depth],[0,-.22,0],square?.4:1,ceramic),cylinder(.055,.018,[0,-.149,0],metal))
  faucet(0,.20,-.48)
  return p
 }
 if(model==='faucet'||model==='faucet-wall'){
  const wall=model==='faucet-wall'
  p.push(shell([1.9,.44,1.45],[0,-.67,.2],v%2?.45:1,white),cylinder(.045,.018,[0,-.59,.2],metal))
  faucet(0,wall?.12:-.02,-.41,wall)
  if(wall)p.push(box([2.2,1.6,.1],[0,0,-.68],{color:'#d3cec3'}))
  return p
 }
 if(model==='shower'){
  const r=.30+v*.055
  p.push(box([1.5,2.25,.10],[0,0,-.49],{color:'#d7d3ca'}),cylinder(.045,1.48,[0,.05,-.36],metal),box([.09,.09,.70],[0,.81,-.06],metal),cylinder(r,.08,[0,.76,.24],metal),cylinder(r*.94,.02,[0,.705,.24],{color:'#dadbd8',metallic:.3}))
  for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)if(x*x+z*z<11)p.push(cylinder(.012,.008,[x*r*.26,.689,.24+z*r*.26],{color:'#414749'}))
  p.push(box([.48,.19,.10],[0,-.44,-.36],metal),cylinder(.07,.10,[0,-.44,-.24],{rotation:[Math.PI/2,0,0],...metal}))
  if(v>0){p.push(cylinder(.023,.36,[.42,-.02,-.3],metal),cylinder(.08,.035,[.42,.15,-.23],{rotation:[Math.PI/2,0,0],...metal}));for(let i=0;i<28;i++){const a=Math.PI*i/27;p.push(sphere([.025,.025,.025],[.21+.21*Math.cos(a),-.10-.57*Math.sin(a),-.29],metal))}}
  return p
 }
 if(model.startsWith('tub')){
  p.push(shell([2.9,.88,1.43],[0,-.73,0],v===0?.52:1,ceramic),cylinder(.045,.016,[0,-.598,0],metal))
  if(model==='tub-claw')for(const x of [-.98,.98])for(const z of [-.42,.42])p.push(sphere([.19,.29,.18],[x,-.86,z],metal))
  else p.push(box([2.2,.12,.8],[0,-.83,0],{color:'#777a79'}))
  faucet(1.05,.09,-.53)
  return p
 }
 if(model.startsWith('enclosure')){
  const screen=model==='enclosure-screen',sliding=model==='enclosure-sliding'
  p.push(box([2.2,.08,1.25],[0,-1.03,0],white),box([2.3,2.1,.065],[0,0,-.65],{color:'#d6d1c5'}))
  const glass={glass:true,color:'#c4dde0',roughness:.03}
  if(screen)p.push(box([1.54,1.96,.035],[-.33,0,.39],glass))
  else{p.push(box([1.00,1.96,.035],[-.54,0,.5],glass),box([1.02,1.96,.035],[.49,0,sliding?.55:.5],glass));for(const y of [-1,.99])p.push(box([2.13,.035,.055],[0,y,.52],metal));p.push(box([.024,.25,.035],[.14,.05,.59],metal));if(!sliding)for(const y of [-.64,.64])p.push(box([.075,.11,.045],[1.015,y,.52],metal))}
  if(sliding)for(const x of [-.90,.88])p.push(cylinder(.04,.06,[x,.90,.55],{rotation:[Math.PI/2,0,0],...metal}))
  p.push(cylinder(.035,1.30,[-.65,.18,-.55],metal),box([.07,.07,.37],[-.65,.82,-.39],metal),cylinder(.19,.04,[-.65,.79,-.20],metal))
  return p
 }
 if(model==='fan'){
  p.push(cylinder(.07,.76,[0,.53,0],{color:v===1?'#af9d76':'#3a3e41',metallic:.5}),sphere([.53,.23,.53],[0,.09,0],{color:v===1?'#ad9474':'#41474c',metallic:.55}))
  const count=v===4?6:v===1?5:3
  for(let i=0;i<count;i++){const a=i*Math.PI*2/count;p.push(box([1.00,.055,.22],[Math.cos(a)*.69,.06,Math.sin(a)*.69],{rotation:[0,-a,.025],color:v===1?'#bdab88':v===4?'#73523c':'#e0e2e1',roughness:.32}))}
  if(v===3||v===4)p.push(cylinder(.20,.07,[0,-.08,0],{color:'#fff4d7',emissive:'#fff1cb'}))
  return p
 }
 if(model.startsWith('light-')){
  const square=model==='light-square',r=.70+v*.065
  p.push(square?box([1.8,.14,1.8],[0,0,0],{color:'#efefeb'}):cylinder(r,.14,[0,0,0],{color:'#efefeb'}),square?box([1.64,.035,1.64],[0,.089,0],{color:'#fff7e0',emissive:'#fff2ce'}):cylinder(r*.91,.035,[0,.089,0],{color:'#fff7e0',emissive:'#fff2ce'}))
  if(v===0)p.push(cylinder(.58,.05,[0,.14,0],{color:'#fcf8ee'}))
  return p
 }
 if(model.startsWith('bulb')){
  const candle=model==='bulb-candle'
  p.push(sphere([candle?.62:1.03,candle?1.04:1.02,candle?.62:1.03],[0,.30,0],{color:'#f5f4ea',roughness:.22}),cylinder(candle?.15:.29,.45,[0,-.32,0],{color:'#e9e9e1'}),cylinder(.19,.34,[0,-.71,0],metal))
  for(let i=0;i<7;i++)p.push(box([.19,.015,.017],[0,-.85+i*.045,.19],metal))
  if(v===0)p.push(cylinder(.45,.055,[0,.12,0],white));if(v===1)p.push(cylinder(.31,.16,[0,-.31,0],{color:'#9dbea0'}));if(v===3)p.push(ring([1.05,.08,1.05],[0,.1,0],{color:'#b5bedb'}))
  return p
 }
 if(model==='batten'){
  const length=v===3?3.1:v===0?2.7:v===1?2.65:v===2?2.6:2.9,height=v===1?.11:v===3?.25:.17
  return [box([length,height,.16],[0,0,0],{color:'#e2e3df'}),box([length-.15,height*.65,.12],[0,height*.59,0],{color:v===2?'#fff3d5':'#fafbf1',roughness:.2}),...[-length/2,length/2].map(x=>box([.08,height+.03,.19],[x,0,0],{color:v===2?'#aab6a0':v===3?'#bdc4c7':'#eeeeea'}))]
 }
 if(model==='exhaust'){
  if(v!==2&&v!==3)p.push(...[[-.9,0],[.9,0],[0,-.9],[0,.9]].map(([x,y])=>box([x===0?1.9:.13,y===0?1.9:.13,.20],[x,y,0],{color:v===1?'#353b3d':'#e5e8e5'})))
  else p.push(ring([1.6,.055,1.6],[0,0,.15],{rotation:[Math.PI/2,0,0],color:v===2?'#333c42':'#c5d5d7',metallic:.4}))
  p.push(cylinder(.70,.12,[0,0,0],{rotation:[Math.PI/2,0,0],color:'#50595b'}))
  const count=[4,5,4,7,3][v]
  for(let i=0;i<count;i++){const a=i*Math.PI*2/count;p.push(box([.62,.18,.06],[Math.cos(a)*.37,Math.sin(a)*.37,.10],{rotation:[0,0,a+.3],color:v%2?'#717d81':'#b5c4c6'}))}
  if(v===0)for(let i=-3;i<=3;i++)p.push(box([1.70,.24,.07],[0,i*.24,.19],{rotation:[-.18,0,0],color:'#ddd8c8'}))
  else if(v!==3)for(let i=-4;i<=4;i++)p.push(box([v===2?Math.sqrt(1.6**2-(i*.18)**2):1.70,.018,.03],[0,i*.18,.17],{color:v===2?'#4c565a':'#c3c9c9'}))
  return p
 }
 if(model.startsWith('heater')){
  const horizontal=model==='heater-horizontal'
  const instant=v>=3,height=instant?1.30:1.65
  p.push(instant||v===0?box([instant?.91:1.03,height,.71],[0,0,0],{color:'#f1f1ea'}):cylinder(.53,height,[0,0,0],{rotation:horizontal?[0,0,Math.PI/2]:undefined,color:'#f1f1ea'}))
  if(v===0)p.push(sphere([.91,1.32,.09],[0,.03,.36],{color:'#29353e'}),box([.23,.13,.035],[0,-.31,.421],{color:'#d9e5e7'}))
  else p.push(box([v===4?.61:.38,v===4?.40:.24,.07],[0,-.25,instant?.39:.52],{color:v===3?'#a7c3ad':v===4?'#333943':'#8fa4b5'}))
  p.push(cylinder(.035,.18,[-.18,-height/2-.08,0],{color:'#5787a8'}),cylinder(.035,.18,[.18,-height/2-.08,0],{color:'#b2604d'}))
  return p
 }
 if(model==='switch'){
  const n=v===2?2:1
  p.push(box([1.60,1.60,.11],[0,0,0],{color,roughness:.3}))
  for(let i=0;i<n;i++)p.push(box([1.22/n,1.06,.065],[(i-(n-1)/2)*.64,0,.079],{rotation:[-.035,0,0],color,roughness:.25}))
  p.push(box([.08,.028,.01],[0,-.40,.12],{color:v===4?'#4d95ae':'#acb6b2'}))
  return p
 }
 if(model==='waterproofing'){
  const bath=item.id==='bath-waterproofing'
  p.push(box([2.9,.22,2.3],[0,-.73,0],{color:'#aaa69c'}),box([2.86,.055,2.26],[0,-.38,0],{color:'#797d7a'}),box([2.82,.045,2.22],[0,-.13,0],{color:v===2?'#acc6c5':'#95a4a0'}),box([2.78,.06,2.18],[0,.15,0],{color:'#c5c0b5'}))
  if(bath){p.push(box([2.9,1.16,.09],[0,-.07,-1.15],{color:'#bbb5aa'}),box([2.77,.36,.07],[0,-.24,-1.07],{color:v===1?'#b69b85':'#95a4a0'}),box([2.77,.035,.12],[0,-.38,-1.0],{color:'#bdb7a4'}));for(let x=0;x<6;x++)for(let z=0;z<5;z++)p.push(box([.42,.05,.40],[-1.11+x*.445,.41,-.84+z*.42],{color:'#ebe6dc'}));p.push(box([.22,.018,.22],[.93,.446,.66],chrome));for(let i=0;i<5;i++)p.push(box([.012,.02,.18],[.86+i*.035,.46,.66],{color:'#4b5151'}))}
  else p.push(box([2.95,.11,.12],[0,.27,-1.15],{color:'#bec8c5'}))
  return p
 }
 return undefined
}
