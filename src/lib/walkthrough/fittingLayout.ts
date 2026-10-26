import type {AssetFace} from './delivery.ts'
type Point=[number,number]
export type CeilingPlacement={surface:AssetFace;x:number;z:number;y:number;radius:number}
function inside([x,z]:Point,face:AssetFace){
 let value=false
 for(let i=0,j=face.vertices.length-1;i<face.vertices.length;j=i++){
  const a=face.vertices[i],b=face.vertices[j]
  if((a[2]>z)!==(b[2]>z)&&x<(b[0]-a[0])*(z-a[2])/(b[2]-a[2])+a[0])value=!value
 }
 return value
}
/** Full fixture footprint must have a real soffit, never just a room bounding
 * box spanning a courtyard, stair hole or disconnected roof surface. */
export function placeCeilingFitting(faces:AssetFace[],width:number,depth:number,occupied:CeilingPlacement[]=[],clearance=.15):CeilingPlacement|null{
 for(const surface of faces){
  const xs=surface.vertices.map(p=>p[0]),zs=surface.vertices.map(p=>p[2]),lo=[Math.min(...xs),Math.min(...zs)],hi=[Math.max(...xs),Math.max(...zs)]
  const radius=Math.hypot(width,depth)/2
  for(const u of [.5,.2,.8,.35,.65])for(const v of [.5,.2,.8,.35,.65]){
   const x=lo[0]+(hi[0]-lo[0])*u,z=lo[1]+(hi[1]-lo[1])*v
   const footprint=[[-1,-1],[-1,1],[1,-1],[1,1],[0,0],[0,-1],[0,1],[-1,0],[1,0]]
   if(!footprint.every(([a,b])=>inside([x+a*(width/2+.03),z+b*(depth/2+.03)],surface)))continue
   if(occupied.some(p=>Math.hypot(x-p.x,z-p.z)<radius+p.radius+clearance))continue
   return {surface,x,z,y:surface.vertices[0][1],radius}
  }
 }
 return null
}
