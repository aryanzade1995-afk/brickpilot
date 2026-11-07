import {useEffect,useMemo} from 'react'
import {useThree} from '@react-three/fiber'
import type {FacadeVariation} from '@/lib/engine/facade/variations.ts'
import {buildFacadeDesignGroup} from '@/lib/three/facadeDesign.ts'
import {useGLTF} from '@react-three/drei'
import {Mesh,type Material} from 'three'
export function FacadeDesignLayer({model,url}:{model:FacadeVariation;url:string}){
 const invalidate=useThree(s=>s.invalidate)
 const {scene}=useGLTF(url)
 const wall=useMemo(()=>{let material:Material|undefined;scene.traverse(o=>{if(!material&&o instanceof Mesh&&o.userData.material_role==='wall')material=Array.isArray(o.material)?o.material[0]:o.material});return material},[scene])
 const prepared=useMemo(()=>buildFacadeDesignGroup(model,invalidate,wall),[model,invalidate,wall])
 useEffect(()=>{invalidate();return()=>prepared.dispose()},[prepared,invalidate])
 return <primitive object={prepared.root} dispose={null}/>
}
