import { DataTexture, RepeatWrapping, RGBAFormat } from 'three'

/** Small deterministic micrograin; no texture downloads or per-frame allocation. */
export function waterSurfaceDetail() {
  const data=new Uint8Array(64*64*4);let seed=317
  for(let i=0;i<data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const v=150+(seed>>>28)*5;data[i]=v;data[i+1]=v;data[i+2]=v;data[i+3]=255}
  const texture=new DataTexture(data,64,64,RGBAFormat);texture.wrapS=texture.wrapT=RepeatWrapping;texture.repeat.set(6,6);texture.needsUpdate=true;return texture
}
