import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BufferGeometry, Color, Float32BufferAttribute, ShaderMaterial, DoubleSide } from 'three'
import type { AirPath } from '@/lib/utilities/ventilation.ts'
import { airWispRoute, type AirProjection } from '@/lib/utilities/airVisual.ts'

const vertex=`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aTangent;
attribute vec2 aFlow;
uniform float uTime; uniform float uViewportHeight;
varying vec2 vUv; varying vec2 vFlow;
void main(){
 vec4 view=modelViewMatrix*vec4(position,1.0);
 vec2 tangent=(modelViewMatrix*vec4(aTangent,0.0)).xy;
 vec2 normal=normalize(vec2(-tangent.y,tangent.x)+vec2(0.00001));
 float pixelM=2.0*abs(view.z)/(projectionMatrix[1][1]*max(1.0,uViewportHeight));
 float width=clamp(0.18,pixelM*5.0,pixelM*11.0);
 float flutter=sin(aFlow.x*1.3-uTime*1.6+aFlow.y*4.0)*width*0.4;
 view.xy+=normal*(uv.y*width+flutter+aFlow.y*width*.65);
 vUv=uv;vFlow=aFlow;
 gl_Position=projectionMatrix*view;
 #include <logdepthbuf_vertex>
}`
const fragment=`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCool;uniform vec3 uWarm;uniform float uTime;
varying vec2 vUv;varying vec2 vFlow;
void main(){
 float edge=exp(-vUv.y*vUv.y*4.0);
 float wave=pow(.5+.5*cos(vFlow.x*1.0-uTime*2.5+vFlow.y*2.0),3.0);
 float thread=exp(-pow(vUv.y-.25*sin(vFlow.x*1.8-uTime),2.0)*22.0);
 float ends=smoothstep(0.0,.035,vUv.x)*(1.0-smoothstep(.965,1.0,vUv.x));
 float alpha=(edge*(.13+.55*wave)+thread*.24*wave)*ends;
 if(alpha<.008)discard;
 #include <logdepthbuf_fragment>
 gl_FragColor=vec4(mix(uCool,uWarm,smoothstep(.15,.85,vUv.x)),alpha);
 #include <colorspace_fragment>
}`

/** Full-length, soft air ribbons with travelling highlights. CPU samples the
 * existing route once; one GPU draw and one time uniform animate every path.
 * No vertex texture fetches, tubes or moving-object allocations are required. */
export function AirflowLayer({paths,running,speed,xray,projectPoint}:{paths:AirPath[];running:boolean;speed:number;xray:boolean;projectPoint?:AirProjection}){
 const time=useRef(0),materialRef=useRef<ShaderMaterial>(null),invalidate=useThree(s=>s.invalidate),height=useThree(s=>s.size.height)
 const resources=useMemo(()=>{
  const positions:number[]=[],tangents:number[]=[],uvs:number[]=[],flows:number[]=[],indices:number[]=[]
  for(const path of paths){
   const route=airWispRoute(path,384,projectPoint);if(!route)continue
   for(const strand of [-1,0,1]){
    const first=positions.length/3
    route.points.forEach((p,i)=>{
     const a=route.points[Math.max(0,i-1)],b=route.points[Math.min(route.points.length-1,i+1)],t=i/(route.points.length-1)
     for(const side of [-1,1]){positions.push(...p);tangents.push(b[0]-a[0],b[1]-a[1],b[2]-a[2]);uvs.push(t,side);flows.push(t*route.length,strand)}
     if(i<route.points.length-1){const at=first+i*2;indices.push(at,at+1,at+2,at+1,at+3,at+2)}
    })
   }
  }
  const geometry=new BufferGeometry()
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('aTangent',new Float32BufferAttribute(tangents,3))
  geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2));geometry.setAttribute('aFlow',new Float32BufferAttribute(flows,2));geometry.setIndex(indices)
  const material=new ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,forceSinglePass:true,depthWrite:false,depthTest:!xray,side:DoubleSide,toneMapped:false,uniforms:{uTime:{value:0},uViewportHeight:{value:570},uCool:{value:new Color('#168DD0')},uWarm:{value:new Color('#E66E32')}}})
  return {geometry,material}
 },[paths,xray,projectPoint])
 useEffect(()=>{if(materialRef.current)materialRef.current.uniforms.uTime.value=time.current;invalidate();return()=>{resources.geometry.dispose();resources.material.dispose()}},[resources,invalidate])
 useEffect(()=>{if(materialRef.current)materialRef.current.uniforms.uViewportHeight.value=height;invalidate()},[height,resources,invalidate])
 useFrame((_,dt)=>{if(running&&materialRef.current){time.current+=Math.min(dt,.06)*speed;materialRef.current.uniforms.uTime.value=time.current;invalidate()}})
 return <mesh name="Moving_air_wisps" geometry={resources.geometry} frustumCulled={false} renderOrder={xray?1000:0} dispose={null}><primitive ref={materialRef} object={resources.material} attach="material"/></mesh>
}
