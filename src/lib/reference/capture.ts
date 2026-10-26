import {Mesh,MeshStandardMaterial,SRGBColorSpace,WebGLRenderTarget} from 'three'
import type {RootState} from '@react-three/fiber'
import {alignedCamera} from './comparison.ts'
import type {ReferenceGeometry} from './reconstruct.ts'
import type {ReferenceSettings} from './schema.ts'
/** Actual shared scene rendered at the reference crop's aspect. This avoids
 * stretching a responsive viewer or scoring an unrelated inspection orbit.
 * GPU target and temporary selection highlighting are restored even on failure. */
export function captureAlignedReference(root:RootState,geometry:ReferenceGeometry,settings:ReferenceSettings,aspect:number){
 const width=Math.max(8,Math.round(320*Math.min(1,aspect))),height=Math.max(8,Math.round(320*Math.min(1,1/aspect))),target=new WebGLRenderTarget(width,height),previous=root.gl.getRenderTarget(),pixels=new Uint8Array(width*height*4),highlighted=new Map<MeshStandardMaterial,number>()
 target.texture.colorSpace=SRGBColorSpace
 root.scene.traverse(object=>{if(object instanceof Mesh&&object.userData.referencePartId)for(const material of Array.isArray(object.material)?object.material:[object.material])if(material instanceof MeshStandardMaterial){highlighted.set(material,material.emissiveIntensity);material.emissiveIntensity=0}})
 try{const {camera}=alignedCamera(geometry,settings,aspect);root.scene.updateMatrixWorld(true);root.gl.setRenderTarget(target);root.gl.clear();root.gl.render(root.scene,camera);root.gl.readRenderTargetPixels(target,0,0,width,height,pixels)
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d')!,image=context.createImageData(width,height)
  for(let y=0;y<height;y++)image.data.set(pixels.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4)
  context.putImageData(image,0,0);return canvas
 }finally{root.gl.setRenderTarget(previous);target.dispose();highlighted.forEach((value,material)=>{material.emissiveIntensity=value});root.invalidate()}
}
