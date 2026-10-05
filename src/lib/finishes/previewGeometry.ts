import type { SpecItem, SpecOption } from '../cost/workspace.ts'
import { experienceOption } from './experiences.ts'
export type PreviewPart={size:[number,number,number];at:[number,number,number];selected?:boolean;glass?:boolean;shape?:'box'|'cylinder'|'sphere'|'torus'|'bowl'|'shell';profile?:number[][];squareness?:number;rotation?:[number,number,number];color?:string;metallic?:number;roughness?:number;emissive?:string}
const B=(size:PreviewPart['size'],at:PreviewPart['at'],extra:Partial<PreviewPart>={}):PreviewPart=>({size,at,selected:false,...extra})
const C=(r:number,h:number,at:PreviewPart['at'],extra:Partial<PreviewPart>={})=>B([r,r,h],at,{shape:'cylinder',...extra})
const S=(size:PreviewPart['size'],at:PreviewPart['at'],color:string)=>B(size,at,{shape:'sphere',color})
const metal={color:'#aab0b2',metallic:.85,roughness:.22},ceramic={color:'#f8f6ee',roughness:.16}
const frame=(w:number,d:number,y:number,t:number,h:number,extra:Partial<PreviewPart>={})=>[B([w,h,t],[0,y,-d/2+t/2],extra),B([w,h,t],[0,y,d/2-t/2],extra),B([t,h,d-2*t],[-w/2+t/2,y,0],extra),B([t,h,d-2*t],[w/2-t/2,y,0],extra)]
export function detailedPreviewParts(item:Pick<SpecItem,'id'|'group'>,option:SpecOption,roomSize?:[number,number]):PreviewPart[]|undefined {
 const id=option.id,exp=experienceOption(option.experienceOptionId),pattern=exp?.pattern
 const named=`${option.name} ${option.tags.join(' ')}`.toLowerCase()
 if(item.id==='false-ceiling'){
  const [w,d]=roomSize??[3.6,3.1],p:PreviewPart[]=[B([w,.08,d],[0,1.2,0],{color:'#aaa9a5'}),B([w,2.25,.07],[0,.03,-d/2],{color:'#dbd9d2'}),B([.07,2.25,d],[-w/2,.03,0],{color:'#dbd9d2'})]
  const type=pattern??(id==='none'?'none':id==='acoustic'?'acoustic-grid':'plain')
  const light={color:'#fff4d9',emissive:'#ffdca1'},finish={selected:true}
  if(type==='none')return p
  if(['plain','shadow','linear','perforated'].includes(type))p.push(B([w-.12,.1,d-.12],[0,1.04,0],finish))
  if(['cove','tray','double-tray','hybrid'].includes(type)){
   p.push(...frame(w-.04,d-.04,.99,.36,.17,type==='hybrid'?{color:'#e8e5dc'}:finish),B([w-.86,.09,d-.86],[0,type==='tray'?1.13:1.08,0],{selected:type!=='hybrid',color:'#e8dfcf'}),...frame(w-.81,d-.81,1.0,.02,.025,light))
   if(type==='double-tray')p.push(...frame(w-1.1,d-1.1,1.01,.16,.14,finish))
  }
  if(type==='shadow')p.push(...frame(w-.03,d-.03,1.1,.022,.04,{color:'#313332'}))
  if(type==='island')p.push(B([w*.7,.16,d*.66],[0,.96,0],finish),...frame(w*.72,d*.68,1.03,.04,.02,light))
  if(type==='linear')for(const x of [-w*.22,w*.22])p.push(B([.035,.03,d*.77],[x,.97,0],light))
  if(['slats','hybrid'].includes(type)){
   const width=type==='hybrid'?w-.86:w-.1,depth=type==='hybrid'?d-.86:d-.1,n=Math.max(4,Math.floor(width/.15))
   for(let i=0;i<n;i++)p.push(B([width/n*.62,.1,depth],[-width/2+(i+.5)*width/n,.95,0],finish))
  }
  if(type==='coffer'){
   for(let i=0;i<=3;i++)p.push(B([w-.1,.16,.10],[0,.99,-d/2+.08+i*(d-.16)/3],finish))
   for(let i=0;i<=3;i++)p.push(B([.10,.16,d-.1],[-w/2+.08+i*(w-.16)/3,.99,0],finish))
  }
  if(['grid','acoustic-grid'].includes(type)){const nx=type==='grid'?5:3,nz=type==='grid'?4:3;for(let x=0;x<nx;x++)for(let z=0;z<nz;z++)p.push(B([w/nx-.025,.09,d/nz-.025],[-w/2+(x+.5)*w/nx,1.0,-d/2+(z+.5)*d/nz],finish))}
  if(type==='perforated')for(let x=0;x<10;x++)for(let z=0;z<8;z++)p.push(C(.018,.012,[-w*.42+x*w*.084,.981,-d*.4+z*d*.11],{color:'#444642'}))
  if(type==='circular'){
   const r=Math.min(w,d)*.38;p.push(C(r,.12,[0,1.0,0],finish),B([r,.025,.022],[0,.93,0],light))
   p.push(B([r*.91,.018,.02],[0,.926,0],{shape:'torus',rotation:[Math.PI/2,0,0],...light}))
  }
  if(!['linear','perforated','coffer','slats','none','plain','shadow'].includes(type))for(const x of [-w*.36,w*.36])for(const z of [-d*.34,d*.34])p.push(C(.045,.018,[x,.895,z],light))
  return p
 }
 if(item.id==='balcony-railings'){
  const type=id==='premium'?'frameless':id==='mid'?'horizontal':id==='basic'?'vertical':/frameless/.test(named)?'frameless':/base clamp/.test(named)?'clamps':/slim framed/.test(named)?'slim':/glass/.test(named)?'glass-post':/cable/.test(named)?'cable':/jali|laser/.test(named)?'jali':/wood|timber/.test(named)?'wood':/stainless/.test(named)?'horizontal':'vertical'
  const p:PreviewPart[]=[B([2.9,.12,.65],[0,-.7,0],{color:'#cbc7be'})]
  if(type==='frameless')return [...p,B([2.6,.09,.09],[0,-.61,0],{...metal,selected:true,color:/black/.test(named)?'#242626':metal.color}),B([2.58,1.08,.035],[0,-.02,0],{glass:true,selected:true}),...(id==='premium'?[B([2.62,.035,.055],[0,.54,0],{...metal,selected:true})]:[])]
  if(type==='clamps')return [...p,B([2.58,1.08,.035],[0,-.02,0],{glass:true}),...[-1.05,0,1.05].map(x=>B([.14,.17,.13],[x,-.54,0],{...metal,selected:true}))]
  if(type==='slim')return [...p,B([2.58,1.08,.035],[0,-.02,0],{glass:true}),...[-1.32,1.32].map(x=>B([.04,1.16,.06],[x,-.02,0],{color:'#eeeeea',selected:true})),...[-.6,.56].map(y=>B([2.68,.04,.06],[0,y,0],{color:'#eeeeea',selected:true}))]
  const steel={...(/stainless|cable|glass/.test(named)||id==='mid'?metal:{color:'#343a3c',metallic:.45}),selected:true}
  for(const x of id==='mid'?[-1.3,1.3]:[-1.3,0,1.3])p.push(/square/.test(named)?B([.045,1.18,.045],[x,-.02,0],steel):C(.032,1.18,[x,-.02,0],steel))
  p.push(B([2.68,.055,.07],[0,.57,0],type==='wood'?{selected:true}:steel))
  if(type==='glass-post')for(const x of [-.65,.65])p.push(B([1.24,1.04,.028],[x,-.03,0],{glass:true}))
  else if(['horizontal','cable'].includes(type))for(let i=0;i<(type==='cable'?6:3);i++)p.push(C(type==='cable'?.007:.016,2.6,[0,-.46+i*(type==='cable'?.16:.33),0],{rotation:[0,0,Math.PI/2],...steel}))
  else if(type==='jali')for(let i=-5;i<=5;i++){p.push(B([.025,.96,.025],[i*.21,-.05,0],{rotation:[0,0,.33],...steel}));p.push(B([.025,.96,.025],[i*.21,-.05,.015],{rotation:[0,0,-.33],...steel}))}
  else for(let i=0;i<(id==='basic'?8:12);i++)p.push(B([/aluminium/.test(named)?.065:.025,1.08,.035],[-1.18+i*(id==='basic'?.337:.215),-.03,0],steel))
  if(id==='rail-balcony')p.push(B([.035,1.02,.54],[1.3,-.03,.28],{glass:true}),B([.07,.055,.65],[1.3,.57,.3],steel))
  if(id==='rail-stair')p.push(B([2.68,.055,.07],[0,-.29,0],{selected:true}))
  return p
 }
 if(item.id==='sanitary'){
  const tier=id==='basic'?0:id==='mid'?1:2,p:PreviewPart[]=[B([2.5,.06,1.6],[0,-1.12,0],{color:'#cdc6b8'}),B([2.5,2.1,.06],[0,-.05,-.7],{color:'#dbd8d0'})]
  p.push(B([.35,tier===2?.22:.47,.52],[-.62,tier===2?-.55:-.79,.05],ceramic),B([.40,.22,.55],[-.62,-.53,.10],{shape:'bowl',...ceramic}),B([.205,.023,.025],[-.62,-.29,.10],{shape:'torus',rotation:[Math.PI/2,0,0],...ceramic}))
  if(tier===0)p.push(B([.41,.48,.18],[-.62,-.41,-.2],ceramic),B([.10,.02,.04],[-.62,-.15,-.2],metal))
  else p.push(B([.25,.16,.016],[-.62,.02,-.65],metal))
  p.push(B([.34,.30,.2],[.58,-.38,.1],{shape:'bowl',...ceramic}))
  if(tier===0)p.push(C(.10,.7,[.58,-.76,.1],ceramic))
  if(tier===1)p.push(B([.72,.45,.52],[.58,-.69,.0],{color:'#aaa08b'}))
  if(tier===2)p.push(B([.82,.28,.58],[.58,-.61,.0],{color:'#71553e'}),B([.88,.07,.62],[.58,-.43,.0],{color:'#e7e2d5'}))
  p.push(C(.025,.18,[.58,-.12,-.18],metal),B([.035,.035,.17],[.58,-.04,-.1],metal),B([.52,.66,.035],[.58,.55,-.65],{glass:true}))
  return p
 }
 if(item.id==='cp-fittings'){
  const tier=id==='basic'?0:id==='mid'?1:2,p:PreviewPart[]=[B([2.45,2.2,.06],[0,0,-.5],{color:'#d7d4cc'}),B([.6,.09,.48],[-.7,-.48,0],ceramic),C(.023,.28,[-.7,-.3,-.09],metal),B([.04,.04,.22],[-.7,-.16,.01],metal)]
  if(tier===0)for(const x of [-.18,.18])p.push(B([.13,.025,.025],[-.7+x,-.36,-.09],metal))
  else p.push(B([.14,.025,.035],[-.7,-.16,-.1],metal))
  p.push(C(.018,tier===0?.5:1.25,[.6,tier===0?.48:.24,-.37],metal),B([.035,.035,.38],[.6,tier===0?.73:.86,-.19],metal))
  p.push(tier===2?B([.4,.045,.4],[.6,.85,.01],metal):C(tier===0?.09:.15,.045,[.6,tier===0?.72:.85,.01],metal))
  p.push(B([tier===2?.2:.3,.13,.06],[.6,-.38,-.41],metal))
  if(tier>0)p.push(C(.025,.25,[.95,.13,-.23],metal),C(.055,.02,[.95,.29,-.17],{rotation:[Math.PI/2,0,0],...metal}),C(.009,.7,[.95,-.29,-.26],metal))
  if(tier===2)for(const y of [-.05,.24,.50])p.push(C(.035,.025,[.6,y,-.45],{rotation:[Math.PI/2,0,0],...metal}))
  return p
 }
 if(item.group==='roof-exterior'){
  const p:PreviewPart[]=[B([3.1,1.8,2.3],[0,-.47,0],{color:'#cccac2'}),B([1.2,.92,.015],[0,-.5,1.158],{glass:true})]
  p.push(B([3.28,.12,2.48],[0,.5,0],{selected:true}))
  p.push(...frame(3.28,2.48,.70,.07,.29,{color:'#ece9e0'}))
  if(id==='tile'||id==='hybrid')for(let x=0;x<(id==='hybrid'?4:8);x++)for(let z=0;z<6;z++)p.push(B([.36,.028,.34],[-1.36+x*.39,.58,-.98+z*.39],{color:'#b87652',selected:true}))
  if(id==='cool')p.push(B([3.02,.016,2.20],[0,.574,0],{color:'#fcfcf3',roughness:.7}))
  if(item.id==='entry-canopy'){p.push(B([1.7,.08,.75],[0,-.03,1.44],{color:'#dedbd2'}))}
  return p
 }
 if(item.id==='landscaping'){
  const type=pattern??(id==='mixed'?'native':id==='garden'?'tropical':'lawn'),dry=['zen','dry'].includes(type)
  const p:PreviewPart[]=[B([3.4,.1,2.8],[0,-.68,0],{color:dry?'#b9b2a1':'#68794f',roughness:1})]
  const foliage=(x:number,y:number,z:number,r:number,height:number,color:string)=>{for(let i=0;i<96;i++){const a=i*2.3999632297,t=(i+.5)/96,v=1-2*t,rad=Math.sqrt(1-v*v)*r,leaf=S([.09,.026,.15],[x+Math.cos(a)*rad,y+v*height/2,z+Math.sin(a)*rad],i%4===0?'#345534':i%3===0?'#71844c':color);leaf.rotation=[.35+v*.65,a,.25*Math.sin(a)];p.push(leaf)}}
  const shrub=(x:number,z:number,size=.32,color='#587247')=>{p.push(C(.022,.32,[x,-.48,z],{color:'#67513e'}));foliage(x,-.32,z,size*.7,size*1.15,color)}
  const planter=(x:number,z:number)=>{p.push(C(.27,.32,[x,-.46,z],{color:'#af9f88'}));shrub(x,z,.34)}
  if(['native','flower','path','formal','tropical'].includes(type))for(let i=0;i<5;i++)p.push(B([.44,.025,.36],[0,-.612,-1+i*.48],{color:'#bdb9ae'}))
  if(type==='formal')for(let i=0;i<9;i++){shrub(-1.3,-1.13+i*.28,.23);shrub(1.3,-1.13+i*.28,.23)}
  if(type==='native'||type==='tropical')for(const [x,z] of [[-1.15,-.8],[-1.05,.75],[1.1,-.7],[1.1,.8]])shrub(x,z,type==='tropical'?.55:.37)
  if(type==='tropical'){p.push(C(.045,1.2,[-.8,-.08,-.8],{color:'#76634d'}));for(let i=0;i<4;i++){const a=i*Math.PI/2;p.push(C(.016,.5,[-.8+Math.cos(a)*.12,.45,-.8+Math.sin(a)*.12],{rotation:[Math.cos(a)*.6,0,Math.sin(a)*.6],color:'#76634d'}))}foliage(-.8,.62,-.8,.48,.65,'#456b46')}
  if(id==='mixed')for(const x of [-.64,.64])p.push(S([.1,.08,.1],[x,-.15,.8],'#b88498'))
  if(id==='garden')p.push(B([1.2,.07,.3],[.6,-.24,.7],{color:'#867058'}),B([.08,.38,.25],[.1,-.46,.7],{color:'#4f5450'}),B([.08,.38,.25],[1.1,-.46,.7],{color:'#4f5450'}))
  if(type==='flower')for(let i=0;i<7;i++)for(const x of [-1.12,1.12]){shrub(x,-1+i*.34,.20);p.push(S([.08,.05,.08],[x,-.07,-1+i*.34],i%2?'#d5b677':'#b67d88'))}
  if(type==='zen'){for(let i=0;i<4;i++)p.push(S([.48,.27,.37],[-1+i*.62,-.5,.18],i%2?'#8e9186':'#c2bfb1'));planter(1.04,-.82)}
  if(type==='dry')for(const [x,z] of [[-1,-.65],[1,.7],[.7,-.8]]){for(let i=0;i<6;i++){const a=i*Math.PI/3;p.push(S([.16,.52,.10],[x+Math.cos(a)*.15,-.34,z+Math.sin(a)*.15],'#66866a'))}}
  if(type==='courtyard'){p[0]=B([3.4,.1,2.8],[0,-.68,0],{color:'#a8a398'});for(const x of [-1.12,1.12])for(const z of [-.88,.88])planter(x,z);p.push(B([1.6,.07,.34],[0,-.24,.6],{color:'#876c4d'}),B([.08,.39,.25],[-.62,-.47,.6],{color:'#53595a'}),B([.08,.39,.25],[.62,-.47,.6],{color:'#53595a'}))}
  return p
 }
 if(item.id==='pool'){
  if(id==='off')return [B([3.4,.12,2.7],[0,-.7,0],{color:'#bab8ad'})]
  const type=pattern??'blue',color=type==='green'?'#599d92':type==='white'?'#e9e8dc':type==='stone'?'#8c9590':'#5789a4'
  const p:PreviewPart[]=[B([3.4,.12,2.7],[0,-.7,0],{color:'#cdc7b9'}),B([2.55,.06,1.85],[0,-.71,0],{color}),...frame(2.65,1.95,-.48,.12,.42,{color}),...frame(2.95,2.25,-.24,.18,.08,{color:type==='stone'?'#99978c':'#e2dfd2'}),B([2.38,.018,1.66],[0,-.40,0],{glass:true,color:type==='green'?'#74b4a5':type==='white'?'#b6d8df':type==='mosaic'?'#4d9db1':type==='stone'?'#89b2b4':'#65b6c0',roughness:.07})]
  if(id==='pool-blue')p.push(B([.48,.12,1.6],[-.95,-.50,0],{color:'#92bbc6'}))
  if(type==='mosaic'){for(let x=0;x<14;x++)for(let z=0;z<10;z++)p.push(B([.16,.01,.16],[-1.12+x*.17,-.666,-.78+z*.17],{color:(x+z)%3?'#3d86a5':'#b4d1cd'}));for(let x=0;x<18;x++)p.push(B([.125,.008,.12],[-1.1+x*.13,-.191,-1.02],{color:x%2?'#4486a0':'#98bfc8'}))}
  if(type==='mosaic')for(let i=0;i<18;i++)for(let j=0;j<3;j++)p.push(B([.11,.10,.012],[-1.12+i*.132,-.34-j*.11,.876],{color:(i+j)%3?'#347896':'#abd4d3'}))
  for(const x of [.9,1.2])p.push(C(.022,.65,[x,-.30,.99],metal))
  for(const y of [-.47,-.3])p.push(C(.018,.3,[1.05,y,.99],{rotation:[0,0,Math.PI/2],...metal}))
  return p
 }
 return undefined
}
