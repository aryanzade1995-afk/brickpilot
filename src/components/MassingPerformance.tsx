/* eslint-disable react/immutability -- Owns Three shadow-map and renderer resolution settings. */
import {useEffect,useRef} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {useProgress} from '@react-three/drei'
import type {OrbitControls} from 'three-stdlib'

/** Keep the expensive static shadow map across orbit frames. Dynamic traffic
 * invalidates it normally. Lower only the moving raster buffer, then restore
 * native resolution before still-image refinement starts. */
export function MassingPerformance({traffic,revision,golden}:{traffic:boolean;revision?:string;golden:boolean}){
 const {gl,controls,setDpr,invalidate}=useThree(),loading=useProgress(s=>s.active)
 const native=useRef(gl.getPixelRatio()),lastChange=useRef(-Infinity),dragging=useRef(false)
 useEffect(()=>{
  const previous=gl.shadowMap.autoUpdate
  gl.shadowMap.autoUpdate=traffic;gl.shadowMap.needsUpdate=true;invalidate()
  return()=>{gl.shadowMap.autoUpdate=previous;gl.shadowMap.needsUpdate=true}
 },[gl,traffic,revision,golden,loading,invalidate])
 useEffect(()=>{
  const orbit=controls as OrbitControls|undefined
  const baseline=native.current
  const canvas=gl.domElement,tabIndex=canvas.getAttribute('tabindex'),label=canvas.getAttribute('aria-label')
  canvas.tabIndex=0;canvas.setAttribute('aria-label','Interactive house model')
  orbit?.listenToKeyEvents(canvas)
  const change=()=>{lastChange.current=performance.now();const desired=Math.min(baseline,1);if(gl.getPixelRatio()!==desired)setDpr(desired);invalidate()}
  const start=()=>{dragging.current=true;change()}
  const end=()=>{dragging.current=false;change()}
  orbit?.addEventListener('start',start);orbit?.addEventListener('change',change);orbit?.addEventListener('end',end)
  return()=>{orbit?.removeEventListener('start',start);orbit?.removeEventListener('change',change);orbit?.removeEventListener('end',end);orbit?.stopListenToKeyEvents();if(tabIndex===null)canvas.removeAttribute('tabindex');else canvas.setAttribute('tabindex',tabIndex);if(label===null)canvas.removeAttribute('aria-label');else canvas.setAttribute('aria-label',label);setDpr(baseline)}
 },[gl,controls,setDpr,invalidate])
 useEffect(()=>{setDpr(traffic?Math.min(native.current,1):native.current);invalidate()},[traffic,setDpr,invalidate])
 useFrame(()=>{
  const moving=dragging.current||performance.now()-lastChange.current<400
  const desired=traffic||moving?Math.min(native.current,1):native.current
  if(gl.getPixelRatio()!==desired)setDpr(desired)
  if(moving)invalidate()
 })
 return null
}
