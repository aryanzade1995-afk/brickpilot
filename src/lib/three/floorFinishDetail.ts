import { DataTexture, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat } from 'three'
import type { Look } from './dressRoom.ts'

/** Finish detail is shading on the existing floor, never raised tile geometry.
 * The selected swatch/colour and roughness remain authoritative. Joint width
 * (2mm) and relief (0.6mm) are illustrative installation assumptions, not BOQ
 * quantities or a manufacturer scan. UVs are source metres (or exported tiles).
 */
export function floorFinishDetail(look: Look, original: number[] = [1, 1]) {
  const surface = look.surface
  if (!surface) return null
  const tile = surface.tileM
  const size = surface.tileSizeM ?? [tile, surface.pattern === 'plank' ? tile / 5 : tile]
  if (!size.every(n => Number.isFinite(n) && n > 0)) return null
  const resolution = 256, pixels = new Uint8Array(resolution * resolution * 4)
  for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const distance = Math.min(Math.min(x, resolution-x)/resolution*size[0], Math.min(y, resolution-y)/resolution*size[1])
    // Smooth narrow joint, without arbitrary colour variation on chosen products.
    const height = Math.round(255*Math.min(1,distance/.001))
    pixels.set([height,height,height,255],(y*resolution+x)*4)
  }
  const texture = new DataTexture(pixels,resolution,resolution,RGBAFormat)
  texture.wrapS=texture.wrapT=RepeatWrapping;texture.repeat.set(original[0]/size[0],original[1]/size[1])
  texture.generateMipmaps=true;texture.minFilter=LinearMipmapLinearFilter;texture.anisotropy=8;texture.flipY=false;texture.needsUpdate=true
  return texture
}
