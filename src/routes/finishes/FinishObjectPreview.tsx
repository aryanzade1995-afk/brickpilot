import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls, RoundedBox } from '@react-three/drei'
import { BufferGeometry, Float32BufferAttribute, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, type Texture } from 'three'
import type { SpecItem, SpecOption } from '@/lib/cost/workspace.ts'
import { detailedPreviewParts, type PreviewPart } from '@/lib/finishes/previewGeometry.ts'
import { finishPreview } from '@/lib/finishes/preview.ts'
import { servicePreviewParts } from '@/lib/finishes/servicePreviewGeometry.ts'

type Part = PreviewPart
const box = (size: Part['size'], at: Part['at'], selected = true): Part => ({ size, at, selected })
function parts(kind: ReturnType<typeof finishPreview>['kind'], item: SpecItem, style: ReturnType<typeof finishPreview>, option: SpecOption): Part[] {
  if (kind === 'window') {
    const thickness=option.id==='upvc'?.12:option.id==='thermal'?.10:.08
    const p = [box([1.8,thickness,.12],[0,.96,0]),box([1.8,thickness,.12],[0,-.96,0]),box([thickness,2,.12],[-.86,0,0]),box([thickness,2,.12],[.86,0,0]),box([thickness*.75,1.9,.1],[0,0,.01]),
      {size:[1.64,1.8,.025],at:[0,0,.02],glass:true,selected:item.id.includes('glass')} as Part]
    if(style.double)p.push({size:[1.64,1.8,.025],at:[0,0,.085],glass:true,selected:item.id==='glass'})
    if(style.bars) for(let i=-3;i<=3;i++)p.push(box([.025,1.85,.025],[i*.22,0,.14]))
    if(style.fixed)p.splice(4,1)
    if(style.slim)for(const part of p.slice(0,4)){ if(part.size[0]<.2)part.size[0]=.04;else part.size[1]=.04 }
    if(style.sliding)p.push(box([.8,.04,.08],[.42,0,.12]))
    return p.map(part => part.glass ? part : { ...part, selected: !item.id.includes('glass') })
  }
  if(kind==='door') {
    const p=[box([.1,2.25,.2],[-.8,0,0],false),box([.1,2.25,.2],[.8,0,0],false),box([1.7,.1,.2],[0,1.08,0],false)]
    const count=style.folding?4:style.sliding||style.double?2:1,w=1.5/count
    for(let i=0;i<count;i++){
      const x=-.75+(i+.5)*w,z=style.sliding?i*.08:style.folding?i%2*.18:0
      if(style.glazed){
        p.push(box([w,.055,.08],[x,1,z]),box([w,.055,.08],[x,-1,z]),box([.04,2,.08],[x-w/2,0,z]),box([.04,2,.08],[x+w/2,0,z]),{size:[w-.08,1.94,.025],at:[x,0,z],glass:true})
      }else p.push(box([w-.015,2.1,.09],[x,0,z],item.id!=='door-hardware'))
      p.push(box([.035,.24,.04],[x+w*.32,0,z+.08],item.id==='door-hardware'))
    }
    if(style.sliding||style.folding)p.push(box([1.7,.04,.24],[0,-1.08,.05],false))
    return p
  }
  if(kind==='railing'||kind==='gate')return [box([2.4,.06,.06],[0,.55,0]),box([2.4,.04,.04],[0,-.5,0]),...(style.glass?[{size:[2.3,1,.03],at:[0,0,0],glass:true,selected:true} as Part]:Array.from({length:9},(_,i)=>box([.035,1.1,.035],[-1.15+i*.2875,0,0])))]
  if(kind==='kitchen') {
    const counter=item.id.includes('counter'),cabinet=item.id.includes('cabinet')
    return [box([2.8,.75,.65],[0,-.5,0],cabinet),box([2.85,.09,.7],[0,-.09,0],counter),box([2.8,.65,.32],[0,.9,-.12],cabinet),...[-.9,0,.9].map(x=>box([.015,.67,.015],[x,-.5,.34],false)),...[-.9,0,.9].map(x=>box([.2,.02,.04],[x,-.23,.36],item.id.includes('hardware'))),...(item.id.includes('sink')?[box([.65,.08,.42],[.65,-.03,.06])]:[])]
  }
  if(kind==='floor'||kind==='roof')return [box([3,.08,2.5],[0,-.3,0]),box([3,1.2,.07],[0,.3,-1.27],false),box([.07,1.2,2.5],[-1.53,.3,0],false)]
  if(kind==='ceiling')return [box([3,.13,2.3],[0,.3,0]),box([2.3,.09,1.7],[0,.18,0],false)]
  return [box([2.8,2.2,.1],[0,0,0]),box([3,.07,1.2],[0,-1.13,.5],false)]
}
const bowlProfile = [[.02,0],[.28,.08],[.47,.35],[.50,.49],[.43,.49],[.38,.30],[.10,.07],[.02,0]].map(([x,y])=>new Vector2(x,y))
function ShellMesh({part:p,children}:{part:PreviewPart;children:ReactNode}) {
 const geometry=useMemo(()=>{
  const g=new BufferGeometry(),vertices:number[]=[],indices:number[]=[],segments=96,profile=p.profile!,power=p.squareness??1
  for(const [r,y] of profile)for(let i=0;i<=segments;i++){
   const a=i/segments*Math.PI*2,c=Math.cos(a),s=Math.sin(a)
   vertices.push(Math.sign(c)*Math.abs(c)**power*r*p.size[0],(y-.5)*p.size[1],Math.sign(s)*Math.abs(s)**power*r*p.size[2])
  }
  for(let j=0;j<profile.length-1;j++)for(let i=0;i<segments;i++){const a=j*(segments+1)+i,b=a+segments+1;indices.push(a,b,a+1,b,b+1,a+1)}
  g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g
 },[p.profile,p.size,p.squareness])
 useEffect(()=>()=>geometry.dispose(),[geometry])
 return <mesh position={p.at} rotation={p.rotation} geometry={geometry} castShadow receiveShadow>{children}</mesh>
}
function PartMesh({part:p,texture,style}: {part:PreviewPart;texture:ReturnType<TextureLoader['load']>|undefined;style:ReturnType<typeof finishPreview>}) {
 // Catalogue surfaces are intentionally unlit: no exposure, tint, environment or tone mapping alters their RGB.
 const material=style.productPreview?.model==='paint'&&p.selected?<meshBasicMaterial color={style.color} toneMapped={false} side={2}/>:
  style.catalogueColour&&p.selected&&texture&&!p.glass?<meshBasicMaterial map={texture} color="#ffffff" toneMapped={false} side={2}/>:
  p.glass?<meshPhysicalMaterial color={p.color??(p.selected?style.color:'#a6cad2')} transparent opacity={p.color ? .5 : .25} roughness={p.roughness??.07} metalness={.08} clearcoat={1} side={2}/>:
  <meshStandardMaterial side={p.shape==='shell'?2:0} map={p.selected&&!p.color?texture:undefined} color={p.color??(p.selected?style.texture?'#ffffff':style.color:'#c4c4bf')} metalness={p.metallic??(p.selected?style.metallic:.05)} roughness={p.roughness??(p.selected?style.roughness:.65)} emissive={p.emissive??'#000000'} emissiveIntensity={p.emissive?2:0}/>
 const common={position:p.at,rotation:p.rotation,castShadow:!p.glass,receiveShadow:true}
 if(p.shape==='shell')return <ShellMesh part={p}>{material}</ShellMesh>
 if(p.shape==='sphere')return <mesh {...common} scale={p.size}><sphereGeometry args={[.5,48,32]}/>{material}</mesh>
 if(p.shape==='cylinder')return <mesh {...common}><cylinderGeometry args={[p.size[0],p.size[1],p.size[2],64]}/>{material}</mesh>
 if(p.shape==='torus')return <mesh {...common}><torusGeometry args={[p.size[0],p.size[1],12,48]}/>{material}</mesh>
 if(p.shape==='bowl')return <mesh {...common} scale={[p.size[0]*2,p.size[1]*2,p.size[2]*2]}><latheGeometry args={[bowlProfile,48]}/>{material}</mesh>
 // BoxGeometry normalises each face to [0,1]. Extruded rounded boxes use world-unit UVs,
 // which clamp most of the catalogue photo to its edge colour on large surfaces.
 if(style.catalogueColour&&!style.productPreview)return <mesh {...common}><boxGeometry args={p.size}/>{material}</mesh>
 return <RoundedBox {...common} args={p.size} radius={Math.min(.025,...p.size.map(v=>v*.15))} smoothness={2}>{material}</RoundedBox>
}
type TextureStatus = 'loading' | 'ready' | 'error'
function PreviewScene({item,option,colour,roomSize,onStatus}:{item:SpecItem;option:SpecOption;colour?:string;roomSize?:[number,number];onStatus:(status:TextureStatus)=>void}) {
 const original=finishPreview(item,option),style=colour?{...original,color:colour,texture:undefined}:original,invalidate=useThree(s=>s.invalidate)
 const [loaded,setLoaded]=useState<{src:string;texture:Texture<HTMLImageElement>}|undefined>()
 const texture=loaded?.src===style.texture?loaded?.texture:undefined
 const drawn=useRef(0)
 useFrame(()=>{if(style.texture&&!texture)return;if(++drawn.current===3)onStatus('ready')})
 useEffect(()=>{
  drawn.current=0
  onStatus('loading')
  if(!style.texture)return
  let active=true
  const src=style.texture,t=new TextureLoader().load(src,()=>{if(active){setLoaded({src,texture:t});invalidate()}},undefined,()=>{if(active){onStatus('error');invalidate()}})
  t.colorSpace=SRGBColorSpace;t.anisotropy=8
  if(!style.catalogueColour){t.wrapS=t.wrapT=RepeatWrapping;t.repeat.set(2,2)}
  return ()=>{active=false;t.dispose()}
 },[style.texture,style.catalogueColour,invalidate,onStatus])
 useEffect(()=>{invalidate()},[option.id,colour,roomSize,invalidate])
 const geometry=servicePreviewParts(item,option)??detailedPreviewParts(item,option,roomSize)??parts(style.kind,item,style,option)
 const ground=style.kind==='roof'?-1.44:style.kind==='pool'||style.kind==='landscape'||style.kind==='railing'?-.78:-1.18
 return <><ambientLight intensity={.75}/><directionalLight castShadow position={[4,6,5]} intensity={2.5} shadow-mapSize={[1024,1024]} shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5} shadow-bias={-.0003}/><directionalLight position={[-3,2,-2]} intensity={1}/>
  {(!style.catalogueColour||style.productPreview)&&<Environment resolution={128}><Lightformer intensity={3} position={[0,4,1]} rotation={[Math.PI/2,0,0]} scale={[5,5,1]}/><Lightformer intensity={2} position={[-4,1,2]} rotation={[0,Math.PI/2,0]} scale={[4,4,1]}/><Lightformer intensity={2} position={[3,1,-3]} rotation={[0,-Math.PI/3,0]} scale={[3,4,1]}/></Environment>}
  <group>{geometry.map((p,i)=><PartMesh key={`${item.id}-${option.id}-${i}`} part={p} texture={texture} style={style}/>)}</group>
  {style.kind!=='ceiling'&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,ground,0]} receiveShadow><planeGeometry args={[14,14]}/><shadowMaterial transparent opacity={.2}/></mesh>}
  <OrbitControls makeDefault enablePan={false} minDistance={2.0} maxDistance={Math.max(12,...(roomSize??[]).map(v=>v*4))}/></>
}
class PreviewBoundary extends Component<{children:ReactNode;resetKey:string},{failed:boolean;resetKey:string}> {
  state={failed:false,resetKey:this.props.resetKey}
  static getDerivedStateFromError(){return {failed:true}}
  static getDerivedStateFromProps(props:{resetKey:string},state:{resetKey:string}){return props.resetKey===state.resetKey?null:{failed:false,resetKey:props.resetKey}}
  render(){return this.state.failed?<p className="p-6 text-sm text-ink-dim">3D preview unavailable on this device. Your finish selection still works.</p>:this.props.children}
}
export function FinishObjectPreview({item,option,colour,roomSize}:{item:SpecItem;option:SpecOption;colour?:string;roomSize?:[number,number]}) {
  const style=finishPreview(item,option),ceilingScale=Math.max(1,...(roomSize??[]).map(v=>v/4.5))
  const key=`${item.id}:${option.id}:${colour??''}`
  const [status,setStatus]=useState<{key:string;value:TextureStatus}>()
  const onStatus=useCallback((value:TextureStatus)=>setStatus({key,value}),[key])
  if(style.kind==='system')return <p className="rounded-lg bg-bg-inset p-4 text-xs text-ink-dim">{style.caption} Your selection is included in the specification and estimate.</p>
  return <figure data-preview-option={option.id} data-preview-image={style.image?.src} data-preview-colour={colour??style.color} data-preview-state={status?.key===key?status.value:'loading'} className="overflow-hidden rounded-xl border border-line bg-bg-inset"><div className="flex items-center justify-between px-4 py-3"><p className="label">{style.kind} preview</p><p className="text-xs text-ink-dim">Drag to rotate</p></div>
    <div className="h-[310px] sm:h-[380px]" aria-label={`3D ${style.kind}: ${option.name}`}><PreviewBoundary key={item.id} resetKey={option.id}><Suspense fallback={<p className="p-5 text-xs">Loading preview…</p>}><Canvas frameloop="always" shadows dpr={[1,2]} camera={{position:style.kind==='ceiling'?[3*ceilingScale,-1.8*ceilingScale,4.8*ceilingScale]:['roof','pool','landscape','waterproofing'].includes(style.kind)||style.productPreview?.model?.startsWith('light')||style.productPreview?.model==='fan'?[3,2.9,4]:style.kind==='railing'?[2,1.1,3.5]:[2.5,1.6,4.8],fov:style.kind==='ceiling'?45:36}} gl={{antialias:true}}><PreviewScene key={item.id} item={item} option={option} colour={colour} roomSize={roomSize} onStatus={onStatus}/></Canvas></Suspense></PreviewBoundary></div>
    {style.kind==='waterproofing'&&<div className="border-t border-line px-4 py-3 text-xs"><p className="mb-2 font-medium">System layers · bottom to top</p><ol className="list-inside list-decimal space-y-1"><li>Concrete substrate</li><li>Prepared / primed surface</li><li>Selected waterproofing coating</li><li>Protection / screed{item.id==='bath-waterproofing'?' and tile finish':''}</li></ol><p className="mt-2">{item.id==='bath-waterproofing'?'Includes wall upturn, junction band and floor drain context.':'Shows the coating turning up at the roof junction.'} Layers are separated for clarity.</p></div>}
    {status?.key===key&&status.value==='error'&&<p role="alert" className="px-4 py-3 text-xs">The selected image could not load. Choose another finish or reload to retry.</p>}
    {style.image&&!style.image.surface&&<div className="border-t border-line px-4 py-3"><p className="label mb-2">{item.id==='glass'?'Catalogue frame finish reference':'Selected product image'}</p><img src={style.image.src} alt={`${option.name} supplier reference`} className="max-h-64 w-full object-contain"/></div>}
    <figcaption className="border-t border-line px-4 py-3 text-xs leading-relaxed text-ink-dim"><p className="mb-1 font-medium text-ink">{option.name}</p>{style.caption}</figcaption></figure>
}
