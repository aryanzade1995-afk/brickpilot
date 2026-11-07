/* eslint-disable react/immutability -- This R3F bridge owns mutable Three rigs and renderer shadow flags; it does not mutate React state or source house geometry. */
import {useEffect,useMemo} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {Group} from 'three'
import type {CurtainMotion} from '@/lib/curtains/motion.ts'
import {createCurtainRig} from '@/lib/three/curtains.ts'

export function WindowCurtains({motion,revision}:{motion:CurtainMotion;revision:number}){
 const {gl,invalidate}=useThree()
 const built=useMemo(()=>{
  const root=new Group();root.name='Interactive_window_curtains'
  const rigs=[...motion.states].map(([id,state])=>{const rig=createCurtainRig(state.window);root.add(rig.root);return {id,rig,previous:NaN}})
  return {root,rigs}
 },[motion])
 useEffect(()=>{gl.shadowMap.needsUpdate=true;invalidate();return()=>built.rigs.forEach(({rig})=>rig.dispose())},[built,gl,invalidate])
 useEffect(()=>{invalidate()},[revision,invalidate])
 useFrame((_,delta)=>{
  const moving=motion.advance(delta);let changed=false
  for(const item of built.rigs){const progress=motion.states.get(item.id)!.progress;if(item.previous===progress)continue;item.rig.apply(progress);item.previous=progress;changed=true}
  // Re-render the fabric during motion, but update the expensive house shadow
  // maps only at rest. Walking must not pay for a shadow rebuild on every fold.
  if(changed){if(!moving)gl.shadowMap.needsUpdate=true;invalidate()}
  if(moving)invalidate()
 })
 return <primitive object={built.root} dispose={null}/>
}
