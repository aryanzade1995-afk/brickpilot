import { DataTexture, Float32BufferAttribute, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, RepeatWrapping, RGBAFormat, Vector3, type Group } from 'three'
import type { WalkthroughAppearancePayload, WalkthroughGeometryPayload } from '../walkthrough/delivery.ts'

const contactMaps = new WeakMap<Group, { signature: string; maps: Map<string, DataTexture> }>()

/** Baked concept contact occlusion from the actual fitted parts, on existing
 * floor triangles. No decals, extra floor planes, lights or per-frame pass.
 * This is visual shading, never a sunlight/engineering analysis. */
export function applyWalkthroughContactDetail(root: Group, geometry: WalkthroughGeometryPayload, appearance: WalkthroughAppearancePayload) {
  const rooms = geometry.metadata.rooms, signature = JSON.stringify([rooms.map(r => [r.id,r.rectMm]), appearance.furniture.map(p => [p.roomId,p.position,p.size,p.rotation])])
  let cache = contactMaps.get(root)
  if (cache?.signature !== signature) {
    cache?.maps.forEach(t => t.dispose()); cache = { signature, maps: new Map() }; contactMaps.set(root, cache)
    for (const room of rooms) {
      const parts = appearance.furniture.filter(p => p.roomId === room.id && p.size[1] > .05 && p.position[1]-p.size[1]/2 < room.elevationM+.3)
      const size=128, pixels=new Uint8Array(size*size*4), r=room.rectMm
      for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
        const px=(r.x+r.w*x/(size-1))/1000, pz=-(r.y+r.h*y/(size-1))/1000
        const edge=Math.min(x/(size-1)*r.w,(1-x/(size-1))*r.w,y/(size-1)*r.h,(1-y/(size-1))*r.h)/1000
        let shade=.16*Math.exp(-edge/.12)
        for(const part of parts) {
          const dx=px-part.position[0], dz=pz-part.position[2], c=Math.cos(part.rotation), s=Math.sin(part.rotation)
          const a=Math.max(0,Math.abs(c*dx-s*dz)-part.size[0]/2), b=Math.max(0,Math.abs(s*dx+c*dz)-part.size[2]/2)
          shade=Math.max(shade,.48*Math.exp(-Math.hypot(a,b)/.14))
        }
        const i=(y*size+x)*4, value=Math.round(255*(1-shade)); pixels.set([value,value,value,255],i)
      }
      const texture=new DataTexture(pixels,size,size,RGBAFormat); texture.channel=1; texture.generateMipmaps=true; texture.minFilter=LinearMipmapLinearFilter; texture.flipY=false; texture.needsUpdate=true
      cache.maps.set(room.id,texture)
    }
  }
  const maps=cache!.maps, point=new Vector3()
  root.updateMatrixWorld(true)
  root.traverse(o => {
    if (!(o instanceof Mesh) || !Array.isArray(o.userData.materialBindings)) return
    const p=o.geometry.attributes.position, uv=new Float32Array(p.count*2), materials=Array.isArray(o.material)?o.material:[o.material]
    let mapped=false
    for(const group of o.geometry.groups) {
      const key=o.userData.materialBindings[group.materialIndex ?? 0]
      if(typeof key !== 'string' || !key.startsWith('[')) continue
      const [,roomId,role]=JSON.parse(key)
      if(role!=='floor') continue
      const room=rooms.find(r=>r.id===roomId), material=materials[group.materialIndex ?? 0]
      if(!room || !(material instanceof MeshStandardMaterial)) continue
      material.aoMap=maps.get(roomId)!; material.aoMapIntensity=1; material.needsUpdate=true; mapped=true
      for(let k=group.start;k<group.start+group.count;k++) {
        const i=o.geometry.index?.getX(k) ?? k; point.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld)
        uv[i*2]=(point.x*1000-room.rectMm.x)/room.rectMm.w; uv[i*2+1]=(-point.z*1000-room.rectMm.y)/room.rectMm.h
      }
    }
    if(mapped)o.geometry.setAttribute('uv1',new Float32BufferAttribute(uv,2))
  })
}

/** A tiny shared woven normal map for procedural upholstery; selected colours
 * and product maps remain authoritative. Not a manufacturer fabric scan. */
export function textileDetailMap() {
  const size=64, pixels=new Uint8Array(size*size*4)
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)pixels.set([128+(x%2?9:-9),128+(y%2?9:-9),254,255],(y*size+x)*4)
  const texture=new DataTexture(pixels,size,size,RGBAFormat);texture.userData.proceduralKey='formstead-woven-v1'
  texture.wrapS=texture.wrapT=RepeatWrapping; texture.repeat.set(12.5,12.5); texture.generateMipmaps=true; texture.minFilter=LinearMipmapLinearFilter; texture.anisotropy=4; texture.needsUpdate=true
  return texture
}

/** Fine illustrative grain normal, never a substitute colour/product photo. */
export function timberDetailMap() {
  const size=128,pixels=new Uint8Array(size*size*4)
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const grain=Math.sin(x*.58+Math.sin(y*.045)*1.8)*.6+Math.sin(x*1.7+y*.018)*.3
    pixels.set([Math.round(128+grain*12),128,254,255],(y*size+x)*4)
  }
  const texture=new DataTexture(pixels,size,size,RGBAFormat);texture.userData.proceduralKey='formstead-timber-v1'
  texture.wrapS=texture.wrapT=RepeatWrapping;texture.repeat.set(2,1);texture.generateMipmaps=true;texture.minFilter=LinearMipmapLinearFilter;texture.anisotropy=8;texture.needsUpdate=true
  return texture
}
