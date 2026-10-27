import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, RingGeometry, ShaderMaterial, DoubleSide, Color } from 'three'
import { createRainField } from '@/lib/water/rainPreview.ts'
import type { BuildingModel } from '@/lib/engine/buildingModel.ts'
import type { VillaPlumbing } from '@/lib/plumbing/villaPlumbing.ts'
import type { RainCollection } from '@/lib/water/simpleSystem.ts'

const rainVertex=`
attribute vec3 aImpact; attribute vec4 aMotion; attribute vec2 aWind;
uniform float uTime; uniform float uTop; varying float vAlpha;
void main(){
 float span=max(0.1,uTop-aImpact.y),p=fract(uTime*aMotion.y/span+aMotion.x);
 float lift=min(span*(1.0-p)+position.y*aMotion.z,span);
 vec3 point=vec3(aImpact.x+aWind.x*lift/span,aImpact.y+lift,aImpact.z+aWind.y*lift/span);
 vAlpha=mix(.46,.02,position.y);
 gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.0);
}`
const splashVertex=`
attribute vec3 aImpact;attribute vec4 aMotion;uniform float uTime;uniform float uTop;varying float vAlpha;
void main(){
 float span=max(.1,uTop-aImpact.y),p=fract(uTime*aMotion.y/span+aMotion.x),life=p/.17;
 float radius=mix(.12,1.25,clamp(life,0.0,1.0));
 vec3 point=aImpact+vec3(position.x*radius,.009,position.y*radius);
 vAlpha=p<.17?(1.0-life)*.45:0.0;
 gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.0);
}`
const fragment=`uniform vec3 uColor;varying float vAlpha;
void main(){
 if(vAlpha<.002)discard;
 gl_FragColor=vec4(uColor,vAlpha);
 #include <colorspace_fragment>
}`
/** Two GPU draws: batched streaks + instanced impact rings. Uniforms change per
 * frame; there is no React state update or per-droplet mesh allocation. */
export function RainWeather({building,ports,roofHeightScale,tank}:{building:BuildingModel;ports:VillaPlumbing['tankPorts'];roofHeightScale:number;tank:RainCollection['tank']}) {
  const {invalidate,gl,scene}=useThree(),visible=useRef(true)
  const rainMaterialRef=useRef<ShaderMaterial>(null),splashMaterialRef=useRef<ShaderMaterial>(null)
  const field=useMemo(()=>createRainField(building,ports,roofHeightScale,tank),[building,ports,roofHeightScale,tank])
  const resources=useMemo(()=>{
    const drops=new BufferGeometry(),positions:number[]=[],impacts:number[]=[],motions:number[]=[],winds:number[]=[]
    for(const d of field.drops)for(const end of [0,1]){positions.push(0,end,0);impacts.push(...d.impact);motions.push(d.phase,d.speedMps,d.lengthM,0);winds.push(...d.wind)}
    drops.setAttribute('position',new Float32BufferAttribute(positions,3));drops.setAttribute('aImpact',new Float32BufferAttribute(impacts,3));drops.setAttribute('aMotion',new Float32BufferAttribute(motions,4));drops.setAttribute('aWind',new Float32BufferAttribute(winds,2))
    const base=new RingGeometry(.075,.095,16),splashes=new InstancedBufferGeometry();splashes.setIndex(base.index!.clone());splashes.setAttribute('position',base.attributes.position.clone());base.dispose()
    const splashImpacts:number[]=[],splashMotions:number[]=[]
    for(const d of field.drops.filter(d=>d.canSplash).slice(0,field.splashCount)){splashImpacts.push(...d.impact);splashMotions.push(d.phase,d.speedMps,d.lengthM,0)}
    splashes.instanceCount=field.splashCount;splashes.setAttribute('aImpact',new InstancedBufferAttribute(new Float32Array(splashImpacts),3));splashes.setAttribute('aMotion',new InstancedBufferAttribute(new Float32Array(splashMotions),4))
    const material=(vertexShader:string,color:string)=>new ShaderMaterial({vertexShader,fragmentShader:fragment,transparent:true,depthWrite:false,depthTest:true,side:DoubleSide,toneMapped:false,uniforms:{uTime:{value:0},uTop:{value:field.topM},uColor:{value:new Color(color)}}})
    return {drops,splashes,rainMaterial:material(rainVertex,'#69838B'),splashMaterial:material(splashVertex,'#B9CFD1')}
  },[field])
  useEffect(()=>()=>{resources.drops.dispose();resources.splashes.dispose();resources.rainMaterial.dispose();resources.splashMaterial.dispose()},[resources])
  // Three.js background state is imperative; restore the original on unmount.
  // eslint-disable-next-line react/immutability
  useEffect(()=>{const original=scene.background;scene.background=new Color('#D4DDDE');invalidate();return()=>{scene.background=original;invalidate()}},[scene,invalidate])
  useEffect(()=>{const observer=new IntersectionObserver(entries=>{visible.current=entries[0]?.isIntersecting??true;if(visible.current)invalidate()});observer.observe(gl.domElement)
    const resume=()=>{if(!document.hidden)invalidate()};document.addEventListener('visibilitychange',resume);return()=>{observer.disconnect();document.removeEventListener('visibilitychange',resume)}
  },[gl,invalidate])
  useFrame(({clock})=>{if(!visible.current||document.hidden)return;if(rainMaterialRef.current)rainMaterialRef.current.uniforms.uTime.value=clock.elapsedTime;if(splashMaterialRef.current)splashMaterialRef.current.uniforms.uTime.value=clock.elapsedTime;invalidate()})
  return <group name="Illustrative_Rain_And_Roof_Garden_Splashes"><lineSegments geometry={resources.drops} frustumCulled={false}><primitive object={resources.rainMaterial} ref={rainMaterialRef} attach="material"/></lineSegments><mesh geometry={resources.splashes} frustumCulled={false}><primitive object={resources.splashMaterial} ref={splashMaterialRef} attach="material"/></mesh></group>
}
