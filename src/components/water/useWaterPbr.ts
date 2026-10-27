import {useEffect,useMemo} from 'react'
import {useTexture} from '@react-three/drei'
import {useThree} from '@react-three/fiber'
import {RepeatWrapping,SRGBColorSpace} from 'three'

/** Redistributable ambientCG CC0 1K pack; shared downloads, owned transforms. */
export function useWaterPbr(kind:'plastic'|'concrete') {
  const asset=kind==='plastic'?'Plastic010':'Concrete034',gl=useThree(s=>s.gl)
  const loaded=useTexture(['Color','NormalGL','Roughness'].map(map=>`/materials/water/${asset}_1K-JPG_${map}.jpg`))
  const [colour,normal,roughness]=loaded
  const maps=useMemo(()=>{
    const [map,normalMap,roughnessMap]=[colour,normal,roughness].map(t=>{const copy=t.clone();copy.wrapS=copy.wrapT=RepeatWrapping;copy.repeat.set(kind==='plastic'?2:3,kind==='plastic'?6:2);copy.anisotropy=Math.min(8,gl.capabilities.getMaxAnisotropy());copy.needsUpdate=true;return copy})
    map.colorSpace=SRGBColorSpace;return {map,normalMap,roughnessMap}
  },[colour,normal,roughness,kind,gl])
  useEffect(()=>()=>{maps.map.dispose();maps.normalMap.dispose();maps.roughnessMap.dispose()},[maps])
  return maps
}
