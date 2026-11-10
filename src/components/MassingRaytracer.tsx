/* eslint-disable react/immutability -- This component owns imperative Three renderer resources. */
import {useEffect,useRef} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {useProgress} from '@react-three/drei'
import {DenoiseMaterial,GradientEquirectTexture,WebGLPathTracer} from 'three-gpu-pathtracer'
import {GenerateMeshBVHWorker} from 'three-mesh-bvh/worker'
import {Matrix4,NormalBlending,type ShaderMaterial,type BufferGeometry} from 'three'
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js'
import type {OrbitControls} from 'three-stdlib'
import {raytraceScene,RAYTRACE_SAMPLES,type RaytraceStatus,type RaytraceQuality} from '@/lib/three/raytraceScene.ts'

// 0.0.24 is pinned for the application's Three version. Its public dispose
// releases the primary targets only; explicitly release its remaining owned
// targets, uniforms and merged geometry without disposing source-model assets.
function releaseTracer(tracer:WebGLPathTracer){
  type Pass={dispose:()=>void;material:ShaderMaterial}
  const owned=tracer as WebGLPathTracer&{_pathTracer:Pass;_lowResPathTracer:Pass;_generator:{geometry:BufferGeometry};_internalBackground?:{dispose:()=>void}}
  const materials=new Set([owned._pathTracer.material,owned._lowResPathTracer.material])
  for(const material of materials){for(const {value} of Object.values(material.uniforms))if(value&&typeof value.dispose==='function')value.dispose();material.dispose()}
  owned._lowResPathTracer.dispose();owned._generator.geometry.dispose();owned._internalBackground?.dispose();tracer.dispose()
}

export default function MassingRaytracer({revision,golden,quality,onStatus}:{revision:string;golden:boolean;quality:RaytraceQuality;onStatus:(status:RaytraceStatus)=>void}){
  const {gl,scene,camera,controls,invalidate,size}=useThree(),loading=useProgress(s=>s.active)
  const current=useRef<WebGLPathTracer|null>(null),visible=useRef(true),moving=useRef(0),matrix=useRef(new Matrix4()),projection=useRef(new Matrix4()),lastReport=useRef(0)
  const target=RAYTRACE_SAMPLES[quality],report=useRef(onStatus),gpu=useRef('Browser GPU'),failed=useRef(false)
  useEffect(()=>{report.current=onStatus},[onStatus])
  useEffect(()=>{
    if(loading){report.current({phase:'preparing',progress:0,samples:0,target,gpu:gpu.current});return}
    let cancelled=false,tracer:WebGLPathTracer|undefined,worker:(GenerateMeshBVHWorker&{dispose:()=>void})|undefined,snapshot:ReturnType<typeof raytraceScene>|undefined,sky:GradientEquirectTexture|undefined,denoise:DenoiseMaterial|undefined,quad:FullScreenQuad|undefined
    failed.current=false
    const context=gl.getContext(),info=context.getExtension('WEBGL_debug_renderer_info')
    gpu.current=info?String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)):'Browser GPU'
    const notify=(phase:RaytraceStatus['phase'],progress=0,message?:string)=>report.current({phase,progress,message,samples:0,target,gpu:gpu.current})
    const prepare=async()=>{
      try{
        if(!context.getExtension('EXT_color_buffer_float'))throw new Error('This browser cannot render floating-point ray-traced images. Interactive view is still available.')
        notify('preparing')
        snapshot=raytraceScene(scene,golden)
        sky=new GradientEquirectTexture(512);sky.topColor.set(golden?'#d5b398':'#b3d3f0');sky.bottomColor.set(golden?'#80745d':'#7b8278');sky.exponent=.7;sky.update()
        snapshot.scene.environment=sky;snapshot.scene.background=sky
        tracer=new WebGLPathTracer(gl);tracer.textureSize.set(1024,1024);tracer.bounces=6;tracer.transmissiveBounces=8;tracer.filterGlossyFactor=.5
        tracer.tiles.set(3,3);tracer.minSamples=1;tracer.renderDelay=200;tracer.fadeDuration=350;tracer.dynamicLowRes=false
        tracer.rasterizeSceneCallback=()=>gl.render(scene,camera)
        denoise=new DenoiseMaterial({sigma:2,kSigma:1,threshold:.15});denoise.transparent=true;denoise.blending=NormalBlending;quad=new FullScreenQuad(denoise)
        const display=denoise,displayQuad=quad
        tracer.renderToCanvasCallback=(target,renderer,sourceQuad)=>{
          display.map=target.texture;display.opacity=sourceQuad.material.opacity
          const clear=renderer.autoClear;renderer.autoClear=false
          displayQuad.render(renderer);renderer.autoClear=clear
        }
        worker=new GenerateMeshBVHWorker() as GenerateMeshBVHWorker&{dispose:()=>void};tracer.setBVHWorker(worker)
        await tracer.setSceneAsync(snapshot.scene,camera,{onProgress:progress=>{if(!cancelled)notify('preparing',progress)}})
        if(cancelled)return
        current.current=tracer;matrix.current.copy(camera.matrixWorld);projection.current.copy(camera.projectionMatrix)
        notify('rendering',1);invalidate()
      }catch(error){if(!cancelled){failed.current=true;notify('error',0,error instanceof Error?error.message:'Ray tracing could not start. Switch to Interactive view.');invalidate()}}
    }
    // Yield the button's loading state before preparing the scene; BVH work runs
    // in a bundled worker, not on the React/UI thread.
    const frame=requestAnimationFrame(()=>void prepare())
    return()=>{cancelled=true;cancelAnimationFrame(frame);current.current=null;worker?.dispose();if(tracer)releaseTracer(tracer);quad?.dispose();denoise?.dispose();sky?.dispose();snapshot?.dispose();invalidate()}
  },[gl,scene,camera,invalidate,revision,golden,loading,target])
  useEffect(()=>{
    const orbit=controls as OrbitControls|undefined
    const change=()=>{moving.current=performance.now();current.current?.updateCamera();invalidate()}
    const observer=new IntersectionObserver(([entry])=>{visible.current=entry.isIntersecting;if(entry.isIntersecting)invalidate()})
    observer.observe(gl.domElement)
    const wake=()=>{if(!document.hidden)invalidate()}
    const lost=()=>{failed.current=true;report.current({phase:'error',samples:0,target,gpu:gpu.current,progress:0,message:'The graphics context was lost. Return to Interactive view and retry.'})}
    orbit?.addEventListener('change',change);document.addEventListener('visibilitychange',wake);gl.domElement.addEventListener('webglcontextlost',lost)
    return()=>{orbit?.removeEventListener('change',change);observer.disconnect();document.removeEventListener('visibilitychange',wake);gl.domElement.removeEventListener('webglcontextlost',lost)}
  },[controls,gl,invalidate,target])
  useEffect(()=>{current.current?.updateCamera();invalidate()},[size.width,size.height,invalidate])
  useFrame(()=>{
    const tracer=current.current,now=performance.now()
    // Offscreen texture uploads / cube maps may leave a target-sized viewport.
    // R3F's automatic render is disabled by this priority-1 callback, so restore
    // the default framebuffer and complete logical viewport explicitly.
    gl.setRenderTarget(null);gl.setViewport(0,0,size.width,size.height);gl.setScissorTest(false)
    if(!tracer||failed.current){if(!gl.getContext().isContextLost())gl.render(scene,camera);return}
    if(document.hidden||!visible.current)return
    camera.updateMatrixWorld()
    if(!matrix.current.equals(camera.matrixWorld)||!projection.current.equals(camera.projectionMatrix)){
      matrix.current.copy(camera.matrixWorld);projection.current.copy(camera.projectionMatrix);moving.current=now;tracer.updateCamera()
    }
    if(now-moving.current<250){gl.render(scene,camera);invalidate();return}
    try{
      tracer.pausePathTracing=tracer.samples>=target
      tracer.renderSample()
      if(now-lastReport.current>250||tracer.samples>=target){lastReport.current=now;report.current({phase:tracer.samples>=target?'complete':'rendering',samples:Math.floor(tracer.samples),target,gpu:gpu.current,progress:1})}
      if(tracer.samples<target)invalidate()
    }catch(error){failed.current=true;report.current({phase:'error',samples:0,target,gpu:gpu.current,progress:0,message:error instanceof Error?error.message:'Ray tracing stopped. Switch to Interactive view.'});gl.render(scene,camera)}
  },1)
  return null
}
