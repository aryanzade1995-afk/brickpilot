/* eslint-disable react/immutability -- This component owns imperative Three renderer resources. */
import {useEffect,useRef} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {useProgress} from '@react-three/drei'
import {DenoiseMaterial,GradientEquirectTexture,WebGLPathTracer} from 'three-gpu-pathtracer'
import {GenerateMeshBVHWorker} from 'three-mesh-bvh/worker'
import {Matrix4,NormalBlending,Texture,type ShaderMaterial,type BufferGeometry} from 'three'
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js'
import type {OrbitControls} from 'three-stdlib'
import {raytraceScene,RAYTRACE_SAMPLES,type RaytraceStatus,type RaytraceQuality} from '@/lib/three/raytraceScene.ts'
import {presentRaytrace,raytraceRenderScale} from '@/lib/three/raytracePerformance.ts'

// 0.0.24 is pinned for the application's Three version. Its public dispose
// releases the primary targets only; explicitly release its remaining owned
// targets, uniforms and merged geometry without disposing source-model assets.
function releaseTracer(tracer:WebGLPathTracer,shared:Set<unknown>){
  type Pass={dispose:()=>void;material:ShaderMaterial}
  const owned=tracer as WebGLPathTracer&{_pathTracer:Pass;_lowResPathTracer:Pass;_generator:{geometry:BufferGeometry};_internalBackground?:{dispose:()=>void}}
  const materials=new Set([owned._pathTracer.material,owned._lowResPathTracer.material])
  for(const material of materials){for(const {value} of Object.values(material.uniforms))if(value&&!shared.has(value)&&typeof value.dispose==='function')value.dispose();material.dispose()}
  owned._lowResPathTracer.dispose();owned._generator.geometry.dispose();owned._internalBackground?.dispose();tracer.dispose()
}

export default function MassingRaytracer({revision,golden,quality,onStatus}:{revision:string;golden:boolean;quality:RaytraceQuality;onStatus:(status:RaytraceStatus)=>void}){
  const {gl,scene,camera,controls,invalidate,size}=useThree(),loading=useProgress(s=>s.active)
  const current=useRef<WebGLPathTracer|null>(null),visible=useRef(true),moving=useRef(0),matrix=useRef(new Matrix4()),projection=useRef(new Matrix4()),lastReport=useRef(0)
  const dirtyCamera=useRef(false),dragging=useRef(false),settings=useRef(quality),lastPresent=useRef(-Infinity),started=useRef(0)
  const completionReported=useRef(false)
  const motion=useRef({last:0,frames:0,ms:0,fps:undefined as number|undefined})
  const target=RAYTRACE_SAMPLES[quality],report=useRef(onStatus),gpu=useRef('Browser GPU'),failed=useRef(false)
  useEffect(()=>{report.current=onStatus},[onStatus])
  // Detail changes reuse the BVH, textures and compiled shader. Resizing the
  // accumulation buffer is handled by the tracer's public renderScale option.
  useEffect(()=>{settings.current=quality;completionReported.current=false;lastReport.current=0;lastPresent.current=-Infinity;started.current=performance.now();invalidate()},[quality,invalidate])
  useEffect(()=>{
    if(loading){report.current({phase:'preparing',progress:0,samples:0,target:RAYTRACE_SAMPLES[settings.current],gpu:gpu.current});return}
    let cancelled=false,tracer:WebGLPathTracer|undefined,worker:(GenerateMeshBVHWorker&{dispose:()=>void})|undefined,snapshot:ReturnType<typeof raytraceScene>|undefined,sky:GradientEquirectTexture|undefined,denoise:DenoiseMaterial|undefined,quad:FullScreenQuad|undefined
    const shared=new Set<unknown>()
    failed.current=false
    started.current=performance.now();lastPresent.current=-Infinity;completionReported.current=false
    const context=gl.getContext(),info=context.getExtension('WEBGL_debug_renderer_info')
    gpu.current=info?String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)):'Browser GPU'
    const notify=(phase:RaytraceStatus['phase'],progress=0,message?:string)=>report.current({phase,progress,message,samples:0,target:RAYTRACE_SAMPLES[settings.current],gpu:gpu.current})
    const prepare=async()=>{
      try{
        if(!context.getExtension('EXT_color_buffer_float'))throw new Error('This browser cannot render floating-point ray-traced images. Interactive view is still available.')
        notify('preparing')
        snapshot=raytraceScene(scene,golden)
        if(scene.userData.photographicExterior&&snapshot.scene.environment instanceof Texture){shared.add(snapshot.scene.environment);shared.add(snapshot.scene.background)}else{
          sky=new GradientEquirectTexture(512);sky.topColor.set(golden?'#d5b398':'#b3d3f0');sky.bottomColor.set(golden?'#80745d':'#7b8278');sky.exponent=.7;sky.update()
          snapshot.scene.environment=sky;snapshot.scene.background=sky
        }
        tracer=new WebGLPathTracer(gl);tracer.textureSize.set(1024,1024);tracer.bounces=8;tracer.transmissiveBounces=10;tracer.filterGlossyFactor=.35
        tracer.tiles.set(3,3);tracer.minSamples=2;tracer.renderDelay=0;tracer.fadeDuration=0;tracer.dynamicLowRes=false
        tracer.rasterizeSceneCallback=()=>gl.render(scene,camera)
        denoise=new DenoiseMaterial({sigma:2,kSigma:1,threshold:.12});denoise.transparent=true;denoise.blending=NormalBlending;quad=new FullScreenQuad(denoise)
        const display=denoise,displayQuad=quad
        tracer.renderToCanvasCallback=(target,renderer,sourceQuad)=>{
          display.sigma=settings.current==='photo'?1.5:2;display.threshold=settings.current==='photo'?.08:.12
          display.map=target.texture;display.opacity=sourceQuad.material.opacity
          const clear=renderer.autoClear;renderer.autoClear=false
          displayQuad.render(renderer);renderer.autoClear=clear
        }
        worker=new GenerateMeshBVHWorker() as GenerateMeshBVHWorker&{dispose:()=>void};tracer.setBVHWorker(worker)
        await tracer.setSceneAsync(snapshot.scene,camera,{onProgress:progress=>{if(!cancelled)notify('preparing',progress)}})
        if(cancelled)return
        current.current=tracer;matrix.current.copy(camera.matrixWorld);projection.current.copy(camera.projectionMatrix);dirtyCamera.current=false
        notify('rendering',1);invalidate()
      }catch(error){if(!cancelled){failed.current=true;notify('error',0,error instanceof Error?error.message:'Enhanced lighting could not start. The view remains interactive.');invalidate()}}
    }
    // Yield the button's loading state before preparing the scene; BVH work runs
    // in a bundled worker, not on the React/UI thread.
    const frame=requestAnimationFrame(()=>void prepare())
    return()=>{cancelled=true;cancelAnimationFrame(frame);current.current=null;worker?.dispose();if(tracer)releaseTracer(tracer,shared);quad?.dispose();denoise?.dispose();sky?.dispose();snapshot?.dispose();invalidate()}
  },[gl,scene,camera,invalidate,revision,golden,loading])
  useEffect(()=>{
    const orbit=controls as OrbitControls|undefined
    const change=()=>{moving.current=performance.now();dirtyCamera.current=true;invalidate()}
    const start=()=>{dragging.current=true;change()}
    const end=()=>{dragging.current=false;change()}
    const observer=new IntersectionObserver(([entry])=>{visible.current=entry.isIntersecting;if(entry.isIntersecting)invalidate()})
    observer.observe(gl.domElement)
    const wake=()=>{if(!document.hidden)invalidate()}
    const lost=()=>{failed.current=true;report.current({phase:'error',samples:0,target,gpu:gpu.current,progress:0,message:'The graphics context was lost. Reload this view to restore the graphics.'})}
    orbit?.addEventListener('start',start);orbit?.addEventListener('change',change);orbit?.addEventListener('end',end);document.addEventListener('visibilitychange',wake);gl.domElement.addEventListener('webglcontextlost',lost)
    return()=>{orbit?.removeEventListener('start',start);orbit?.removeEventListener('change',change);orbit?.removeEventListener('end',end);observer.disconnect();document.removeEventListener('visibilitychange',wake);gl.domElement.removeEventListener('webglcontextlost',lost)}
  },[controls,gl,invalidate,target])
  useEffect(()=>{dirtyCamera.current=true;moving.current=performance.now();invalidate()},[size.width,size.height,invalidate])
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
      matrix.current.copy(camera.matrixWorld);projection.current.copy(camera.projectionMatrix);moving.current=now;dirtyCamera.current=true
    }
    if(dragging.current||now-moving.current<450){
      gl.render(scene,camera)
      const sample=motion.current,dt=now-sample.last;sample.last=now
      if(dt>0&&dt<200){sample.frames++;sample.ms+=dt}
      if(sample.ms>=600){sample.fps=Math.round(sample.frames*1000/sample.ms);sample.frames=0;sample.ms=0;lastReport.current=now;report.current({phase:'moving',samples:0,target,gpu:gpu.current,progress:0,movementFps:sample.fps})}
      invalidate();return
    }
    if(dirtyCamera.current){tracer.updateCamera();dirtyCamera.current=false;completionReported.current=false;started.current=now;lastReport.current=0;lastPresent.current=-Infinity;motion.current.last=0;motion.current.frames=0;motion.current.ms=0}
    try{
      const scale=raytraceRenderScale(settings.current,size.width,size.height,gl.getPixelRatio(),gpu.current)
      if(Math.abs(tracer.renderScale-scale)>1e-6){tracer.renderScale=scale;tracer.reset();completionReported.current=false;lastPresent.current=-Infinity;lastReport.current=0}
      // Preserve the previous canvas between tiles. With preserveDrawingBuffer
      // enabled, only the displayed image needs the costly full-screen filter.
      tracer.renderToCanvas=presentRaytrace(now,lastPresent.current,tracer.samples,target)
      tracer.pausePathTracing=tracer.samples>=target
      tracer.renderSample()
      if(tracer.renderToCanvas)lastPresent.current=now
      const complete=tracer.samples>=target&&tracer.renderToCanvas
      if(complete?!completionReported.current:now-lastReport.current>500){lastReport.current=now;completionReported.current=complete;report.current({phase:complete?'complete':'rendering',samples:Math.floor(tracer.samples),target,gpu:gpu.current,progress:1,elapsedMs:Math.round(now-started.current),renderWidth:tracer.target.width,renderHeight:tracer.target.height,movementFps:motion.current.fps})}
      if(!complete)invalidate()
    }catch(error){failed.current=true;report.current({phase:'error',samples:0,target,gpu:gpu.current,progress:0,message:error instanceof Error?error.message:'Enhanced lighting stopped. The view remains interactive.'});gl.render(scene,camera)}
  },1)
  return null
}
