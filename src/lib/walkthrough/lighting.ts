import type {WalkthroughAppearancePayload} from './delivery.ts'
import {fnv} from '../engine/massing/rng.ts'
export const LIGHTING_VERSION='cycles-daylight-sky-v2'
/** Paint/albedo edits reuse neutral irradiance. Geometry, emitter or optical
 * class changes invalidate the bake without changing the accepted building. */
export function lightingLayoutSignature(app:WalkthroughAppearancePayload){
 return `light-${fnv(JSON.stringify([LIGHTING_VERSION,app.furniture.map(p=>[p.id,p.position,p.size,p.rotation,p.shape]),app.models?.map(m=>[m.id,m.assetRevision,m.position,m.scale,m.rotation]),app.skins.map(s=>[s.id,s.vertices]),Object.entries(app.bindings).sort(([a],[b])=>a.localeCompare(b)).map(([k,l])=>[k,l.metal??0,l.opacity??1,l.emissive??'',l.glow??0])]))}`
}
export type LightingManifest={version:1;identity:string;planId:string;sourceSha256:string;layoutSignature:string;preset:'daylight';transport:'neutral-indirect-diffuse';directLightBaked:false;skyDirectBaked?:boolean;albedoBaked:false;uvChannel:2;resolution:number;samples:number;device:string;seconds:number;layoutBytes:number;
 atlases:{id:string;irradiance:string;ao:string;width:number;height:number}[];
 meshes:{name:string;sourceId?:string;atlas:number;offset:number;count:number}[];
 files:{name:string;bytes:number;sha256:string}[];qualifications:string[]}
