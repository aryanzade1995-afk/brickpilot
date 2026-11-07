import {useEffect,useMemo} from 'react'
import {useGLTF} from '@react-three/drei'
import type {BuildingModel} from '@/lib/engine/buildingModel.ts'
import {buildPlinthEnclosureGroup} from '@/lib/three/plinthEnclosure.ts'

export function PlinthEnclosureLayer({building,url}:{building:BuildingModel;url:string}){
 const {scene}=useGLTF(url)
 const enclosure=useMemo(()=>buildPlinthEnclosureGroup(building,scene),[building,scene])
 useEffect(()=>()=>enclosure.dispose(),[enclosure])
 return <primitive object={enclosure.root} dispose={null}/>
}
