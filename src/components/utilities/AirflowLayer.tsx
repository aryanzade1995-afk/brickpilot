import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BufferGeometry, Color, DataTexture, Float32BufferAttribute, FloatType, RGBAFormat, ShaderMaterial, DoubleSide, NearestFilter } from 'three'
import type { AirPath } from '@/lib/utilities/ventilation.ts'
import { airWispRoute } from '@/lib/utilities/airVisual.ts'

const vertex=`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aFlow;
uniform sampler2D uPaths;
uniform float uSamples; uniform float uRoutes; uniform float uTime; uniform float uViewportHeight;
varying vec2 vUv; varying float vProgress; varying float vVisible;
vec3 route(float along,float row){
 float index=clamp(along,0.0,1.0)*(uSamples-1.0);
 vec2 a=vec2((floor(index)+0.5)/uSamples,(row+0.5)/uRoutes);
 vec2 b=vec2((min(floor(index)+1.0,uSamples-1.0)+0.5)/uSamples,a.y);
 return mix(texture2D(uPaths,a).xyz,texture2D(uPaths,b).xyz,fract(index));
}
void main(){
 float lengthM=texture2D(uPaths,vec2(0.5/uSamples,(aFlow.x+0.5)/uRoutes)).w;
 float head=fract(uTime*(1.1+aFlow.w*0.55)/max(0.01,lengthM)+aFlow.y);
 float along=head-(1.0-position.x)*aFlow.z/max(0.01,lengthM);
 vec3 point=route(along,aFlow.x);
 vec3 tangent=route(along+0.002,aFlow.x)-route(along-0.002,aFlow.x);
 vec4 view=modelViewMatrix*vec4(point,1.0);
 vec2 direction=(modelViewMatrix*vec4(tangent,0.0)).xy;
 vec2 normal=normalize(vec2(-direction.y,direction.x)+vec2(0.00001));
 float flutter=sin(position.x*9.0+uTime*1.7+aFlow.y*45.0)*0.09;
 // Presentation width stays readable in a whole-house view and bounded
 // when zoomed in. This is an illustrative halo, not a pipe/flow diameter.
 float pixelM=2.0*abs(view.z)/(projectionMatrix[1][1]*max(1.0,uViewportHeight));
 float width=clamp(0.13+aFlow.w*0.07,pixelM*8.0,pixelM*16.0)*sin(position.x*3.14159);
 view.xy+=normal*(position.y*width+flutter+sin(aFlow.y*83.0)*0.025);
 vUv=vec2(position.x,position.y);vProgress=clamp(along,0.0,1.0);
 vVisible=step(0.0,along)*step(along,1.0);
 gl_Position=projectionMatrix*view;
 #include <logdepthbuf_vertex>
}`
const fragment=`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCool;uniform vec3 uWarm;uniform float uTime;
varying vec2 vUv;varying float vProgress;varying float vVisible;
void main(){
 float edge=exp(-vUv.y*vUv.y*3.2);
 float thread=vUv.y-0.22*sin(vUv.x*12.0-uTime*1.1);
 float core=exp(-thread*thread*30.0);
 float tail=pow(max(0.0,sin(vUv.x*3.14159)),0.8);
 float filaments=0.8+0.2*sin(vUv.x*22.0+vUv.y*5.0-uTime*0.7);
 float alpha=(edge*0.56+core*0.28)*tail*filaments*vVisible;
 if(alpha<0.008)discard;
 #include <logdepthbuf_fragment>
 gl_FragColor=vec4(mix(uCool,uWarm,smoothstep(0.1,0.9,vProgress)),alpha);
 #include <colorspace_fragment>
}`

/** Soft moving ribbon fragments: no fixed lines, tubes, dots or arrows.
 * One GPU draw; only time changes per frame. This is a flow illustration. */
export function AirflowLayer({paths,running,speed,xray}:{paths:AirPath[];running:boolean;speed:number;xray:boolean}){
 const time=useRef(0),materialRef=useRef<ShaderMaterial>(null),invalidate=useThree(s=>s.invalidate),height=useThree(s=>s.size.height)
 const resources=useMemo(()=>{
  const samples=192,routes=paths.flatMap(p=>{const r=airWispRoute(p,samples);return r?[r]:[]})
  const texels=new Float32Array(samples*Math.max(1,routes.length)*4)
  routes.forEach((r,row)=>r.points.forEach((p,i)=>texels.set([...p,r.length],(row*samples+i)*4)))
  const texture=new DataTexture(texels,samples,Math.max(1,routes.length),RGBAFormat,FloatType)
  texture.minFilter=texture.magFilter=NearestFilter;texture.needsUpdate=true
  const positions:number[]=[],flows:number[]=[],indices:number[]=[],steps=22
  routes.forEach((route,row)=>{
   const wisps=Math.min(32,Math.max(8,Math.ceil(route.length/1.8)))
   for(let w=0;w<wisps;w++){
    const first=positions.length/3,phase=(w/wisps+row*.173)%1,seed=((w*37+row*19)%101)/101
    for(let s=0;s<=steps;s++)for(const side of [-1,1]){positions.push(s/steps,side,0);flows.push(row,phase,1.2+seed*1.6,seed)}
    for(let s=0;s<steps;s++){const a=first+s*2;indices.push(a,a+1,a+2,a+1,a+3,a+2)}
   }
  })
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('aFlow',new Float32BufferAttribute(flows,4));geometry.setIndex(indices)
  const material=new ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,depthTest:!xray,side:DoubleSide,toneMapped:false,uniforms:{uPaths:{value:texture},uSamples:{value:samples},uRoutes:{value:Math.max(1,routes.length)},uTime:{value:0},uViewportHeight:{value:570},uCool:{value:new Color('#168DD0')},uWarm:{value:new Color('#E66E32')}}})
  return {geometry,material,texture}
 },[paths,xray])
 useEffect(()=>{if(materialRef.current)materialRef.current.uniforms.uTime.value=time.current;invalidate();return()=>{resources.geometry.dispose();resources.material.dispose();resources.texture.dispose()}},[resources,invalidate])
 useEffect(()=>{if(materialRef.current)materialRef.current.uniforms.uViewportHeight.value=height;invalidate()},[height,resources,invalidate])
 useFrame((_,dt)=>{if(running&&materialRef.current){time.current+=Math.min(dt,.06)*speed;materialRef.current.uniforms.uTime.value=time.current;invalidate()}})
 return <mesh name="Moving_air_wisps" geometry={resources.geometry} frustumCulled={false} renderOrder={xray?1000:0} dispose={null}><primitive ref={materialRef} object={resources.material} attach="material"/></mesh>
}
