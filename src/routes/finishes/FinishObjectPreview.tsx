import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { RepeatWrapping, SRGBColorSpace, TextureLoader } from 'three'
import type { SpecItem, SpecOption } from '@/lib/cost/workspace.ts'
import { finishPreview } from '@/lib/finishes/preview.ts'

type Part = { size: [number, number, number]; at: [number, number, number]; selected?: boolean; glass?: boolean }
const box = (size: Part['size'], at: Part['at'], selected = true): Part => ({ size, at, selected })
function parts(kind: ReturnType<typeof finishPreview>['kind'], item: SpecItem, style: ReturnType<typeof finishPreview>): Part[] {
  if (kind === 'window') {
    const p = [box([1.8,.08,.12],[0,.96,0]),box([1.8,.08,.12],[0,-.96,0]),box([.08,2,.12],[-.86,0,0]),box([.08,2,.12],[.86,0,0]),box([.06,1.9,.1],[0,0,.01]),
      {size:[1.64,1.8,.025],at:[0,0,.02],glass:true,selected:item.id.includes('glass')} as Part]
    if(style.bars) for(let i=-3;i<=3;i++)p.push(box([.025,1.85,.025],[i*.22,0,.14]))
    if(style.fixed)p.splice(4,1)
    if(style.slim)for(const part of p.slice(0,4)){ if(part.size[0]<.2)part.size[0]=.04;else part.size[1]=.04 }
    if(style.sliding)p.push(box([.8,.04,.08],[.42,0,.12]))
    return p.map(part => part.glass ? part : { ...part, selected: !item.id.includes('glass') })
  }
  if(kind==='door')return [box([.1,2.25,.2],[-.8,0,0],false),box([.1,2.25,.2],[.8,0,0],false),box([1.7,.1,.2],[0,1.08,0],false),box([1.5,2.1,.09],[0,0,0],item.id!=='door-hardware'),box([.05,.3,.06],[.55,0,.09],item.id==='door-hardware'),...(style.double?[box([.015,2.1,.012],[0,0,.055],false)]:[])]
  if(kind==='railing'||kind==='gate')return [box([2.4,.06,.06],[0,.55,0]),box([2.4,.04,.04],[0,-.5,0]),...(style.glass?[{size:[2.3,1,.03],at:[0,0,0],glass:true,selected:true} as Part]:Array.from({length:9},(_,i)=>box([.035,1.1,.035],[-1.15+i*.2875,0,0])))]
  if(kind==='kitchen') {
    const counter=item.id.includes('counter'),cabinet=item.id.includes('cabinet')
    return [box([2.8,.75,.65],[0,-.5,0],cabinet),box([2.85,.09,.7],[0,-.09,0],counter),box([2.8,.65,.32],[0,.9,-.12],cabinet),...[-.9,0,.9].map(x=>box([.015,.67,.015],[x,-.5,.34],false)),...[-.9,0,.9].map(x=>box([.2,.02,.04],[x,-.23,.36],item.id.includes('hardware'))),...(item.id.includes('sink')?[box([.65,.08,.42],[.65,-.03,.06])]:[])]
  }
  if(kind==='floor'||kind==='roof')return [box([3,.08,2.5],[0,-.3,0]),box([3,1.2,.07],[0,.3,-1.27],false),box([.07,1.2,2.5],[-1.53,.3,0],false)]
  if(kind==='ceiling')return [box([3,.13,2.3],[0,.3,0]),box([2.3,.09,1.7],[0,.18,0],false)]
  return [box([2.8,2.2,.1],[0,0,0]),box([3,.07,1.2],[0,-1.13,.5],false)]
}
function PreviewScene({item,option}:{item:SpecItem;option:SpecOption}) {
  const style=finishPreview(item,option), invalidate=useThree(s=>s.invalidate)
  const texture=useMemo(()=> {
    if(!style.texture)return undefined
    const t=new TextureLoader().load(style.texture, () => invalidate());t.colorSpace=SRGBColorSpace;t.wrapS=t.wrapT=RepeatWrapping;t.repeat.set(2,2);return t
  },[style.texture,invalidate])
  useEffect(()=>()=>texture?.dispose(),[texture])
  return <><ambientLight intensity={1.6}/><directionalLight position={[4,6,5]} intensity={3}/><directionalLight position={[-3,2,1]} intensity={1}/>
    <group>{parts(style.kind,item,style).map((p,i)=><mesh key={`${style.kind}-${i}`} position={p.at}><boxGeometry args={p.size}/>
      {p.glass?<meshPhysicalMaterial color={p.selected&&/tint|solar/i.test(option.name)?'#7b929c':'#adc6ce'} transparent opacity={.3} roughness={.08} metalness={.1} side={2}/>:
        <meshStandardMaterial map={p.selected?texture:undefined} color={p.selected?style.texture?'#ffffff':style.color:'#c4c4bf'} metalness={p.selected?style.metallic:.1} roughness={p.selected?style.roughness:.8}/>}</mesh>)}</group>
    <OrbitControls makeDefault enablePan={false} minDistance={2.5} maxDistance={8}/></>
}
class PreviewBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<p className="p-6 text-sm text-ink-dim">3D preview unavailable on this device. Your finish selection still works.</p>:this.props.children}
}
export function FinishObjectPreview({item,option}:{item:SpecItem;option:SpecOption}) {
  const style=finishPreview(item,option)
  if(style.kind==='system')return <p className="rounded-lg bg-bg-inset p-4 text-xs text-ink-dim">{style.caption} Your selection is included in the specification and estimate.</p>
  return <figure className="overflow-hidden rounded-xl border border-line bg-bg-inset"><div className="flex items-center justify-between px-4 py-3"><p className="label">{style.kind} preview</p><p className="text-xs text-ink-dim">Drag to rotate</p></div>
    <div className="h-[260px] sm:h-[320px]" aria-label={`3D ${style.kind}: ${option.name}`}><PreviewBoundary><Suspense fallback={<p className="p-5 text-xs">Loading preview…</p>}><Canvas frameloop="demand" dpr={[1,1.5]} camera={{position:[3,2.3,4.8],fov:40}} gl={{antialias:true}}><PreviewScene item={item} option={option}/></Canvas></Suspense></PreviewBoundary></div>
    <figcaption className="border-t border-line px-4 py-3 text-xs leading-relaxed text-ink-dim"><p className="mb-1 font-medium text-ink">{option.name}</p>{style.caption}</figcaption></figure>
}
