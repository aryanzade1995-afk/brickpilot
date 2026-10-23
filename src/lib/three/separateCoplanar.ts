import * as THREE from 'three'

type Point = [number, number]
type Tri = { mesh: number; points: Point[]; x0: number; y0: number; x1: number; y1: number }
const nameOf = (m: THREE.Object3D) => `${m.name} ${m.parent?.name ?? ''}`
const plate = (m: THREE.Mesh) => m.userData.level_plate || /slab|deck|tread|landing|plinth|foundation/i.test(nameOf(m))
function rank(m: THREE.Mesh) {
  // Walking surfaces and their soffits keep their exact source elevation.
  if (plate(m)) return 100
  const name = nameOf(m)
  if (/^(PCC|Footing)_/i.test(name)) return 0
  if (/beam|column/i.test(name)) return 1
  if (plate(m)) return 2
  if (/wall/i.test(name)) return 3
  return 4
}

/** Exact 2D triangle overlap. Bounding boxes alone mistake adjacent triangular
 * halves and distant slab partitions for duplicated surfaces. */
function overlaps(a: Point[], b: Point[]) {
  const cross = (p: Point, q: Point, r: Point) => (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
  const sign = cross(b[0], b[1], b[2]) >= 0 ? 1 : -1
  let poly = a
  for (let edge = 0; edge < 3 && poly.length; edge++) {
    const p = b[edge], q = b[(edge+1)%3], out: Point[] = []
    for (let i = 0; i < poly.length; i++) {
      const v = poly[i], w = poly[(i+1)%poly.length], dv = sign*cross(p,q,v), dw = sign*cross(p,q,w)
      if (dv >= 0) out.push(v)
      if ((dv < 0 && dw > 0) || (dv > 0 && dw < 0)) {
        const t = dv/(dv-dw); out.push([v[0]+t*(w[0]-v[0]), v[1]+t*(w[1]-v[1])])
      }
    }
    poly = out
  }
  return Math.abs(poly.reduce((area,p,i) => { const q=poly[(i+1)%poly.length]; return area+p[0]*q[1]-q[0]*p[1] },0)) > .000002
}

/** Separate genuinely overlapping, same-facing exported surfaces once.
 * Local overlap graphs replace the old whole-plane ranking, which accumulated
 * centimetres of distortion across unrelated parts. Source floor heights stay
 * fixed; decorative separation is bounded to 4.5mm and never repeated. */
export function separateCoplanar(root: THREE.Object3D, step = .0015) {
  if (root.userData.coplanarPrepared) return { planes: 0, meshes: 0 }
  root.updateMatrixWorld(true)
  const meshes: THREE.Mesh[] = []
  root.traverse(o => { if (o instanceof THREE.Mesh && o.visible && o.geometry.attributes.position) meshes.push(o) })
  const planes = new Map<string, Tri[]>(), a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3(), n=new THREE.Vector3()
  const volume = meshes.map((m,mesh) => {
    const p=m.geometry.attributes.position, index=m.geometry.index
    for(let i=0;i<(index?.count ?? p.count);i+=3) {
      ;[a,b,c].forEach((v,k)=>v.fromBufferAttribute(p,index?.getX(i+k) ?? i+k).applyMatrix4(m.matrixWorld))
      n.crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize()
      const axis=[Math.abs(n.x),Math.abs(n.y),Math.abs(n.z)].findIndex(v=>v>.999)
      if(axis<0)continue
      const axes=[0,1,2].filter(v=>v!==axis), points=[a,b,c].map(v=>[v.getComponent(axes[0]),v.getComponent(axes[1])] as Point)
      const key=`${axis}|${Math.sign(n.getComponent(axis))}|${Math.round(a.getComponent(axis)*1000)}`
      const tri={mesh,points,x0:Math.min(...points.map(p=>p[0])),y0:Math.min(...points.map(p=>p[1])),x1:Math.max(...points.map(p=>p[0])),y1:Math.max(...points.map(p=>p[1]))}
      const list=planes.get(key) ?? [];list.push(tri);planes.set(key,list)
    }
    const size=new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());return size.x*size.y*size.z
  })
  const moves=new Map<number,{axis:number;sign:number;at:number;by:number}[]>()
  for(const [key,tris] of planes) {
    const graph=new Map<number,Set<number>>()
    tris.sort((a,b)=>a.x0-b.x0)
    for(let i=0;i<tris.length;i++)for(let j=i+1;j<tris.length && tris[j].x0<tris[i].x1-.0001;j++) {
      const a=tris[i],b=tris[j]
      if(a.mesh===b.mesh || graph.get(a.mesh)?.has(b.mesh) || Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0)<.0001 || !overlaps(a.points,b.points))continue
      for(const [p,q] of [[a.mesh,b.mesh],[b.mesh,a.mesh]]) {const neighbours=graph.get(p) ?? new Set();neighbours.add(q);graph.set(p,neighbours)}
    }
    const [axis,sign,mm]=key.split('|').map(Number), levels=new Map<number,number>()
    const order=[...graph.keys()].sort((a,b)=>rank(meshes[b])-rank(meshes[a]) || volume[b]-volume[a] || a-b)
    for(const mi of order) {
      const used=new Set([...graph.get(mi)!].map(i=>levels.get(i)).filter(v=>v!==undefined))
      let level=0;while(used.has(level))level++
      // Never reshape a slab top/bottom, including two legacy overlapping plates.
      if(plate(meshes[mi]))level=0
      levels.set(mi,level)
      if(!level)continue
      const list=moves.get(mi) ?? [];list.push({axis,sign,at:mm/1000,by:Math.min(level*Math.abs(step),.0045)});moves.set(mi,list)
    }
  }
  const w=new THREE.Vector3()
  for(const [mi,list] of moves) {
    const mesh=meshes[mi];mesh.geometry=mesh.geometry.clone()
    const p=mesh.geometry.attributes.position as THREE.BufferAttribute,inverse=mesh.matrixWorld.clone().invert()
    for(let i=0;i<p.count;i++) {
      w.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld)
      const original=w.clone()
      for(const move of list)if(Math.abs(original.getComponent(move.axis)-move.at)<.0006)w.setComponent(move.axis,original.getComponent(move.axis)-move.sign*move.by)
      w.applyMatrix4(inverse);p.setXYZ(i,w.x,w.y,w.z)
    }
    p.needsUpdate=true;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere()
  }
  root.userData.coplanarPrepared=true
  return {planes:[...moves.values()].reduce((n,m)=>n+m.length,0),meshes:moves.size}
}
