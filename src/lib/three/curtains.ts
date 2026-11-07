import * as THREE from 'three'
import type {CurtainWindow} from '../curtains/layout.ts'

/** Pleats are baked once. Animation only changes panel width/translation. */
function fabricGeometry(){
 const g=new THREE.PlaneGeometry(1,1,48,8),p=g.attributes.position
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i);p.setXYZ(i,x,y,Math.sin((x+.5)*Math.PI*16)*.026*(.85+.15*(.5-y)))}
 g.computeVertexNormals();return g
}
export function createCurtainRig(window:CurtainWindow){
 const root=new THREE.Group();root.name=`Curtain_${window.id}`;root.position.set(...window.position);root.rotation.y=window.rotation
 root.userData.curtainWindowId=window.id
 const material=new THREE.MeshPhysicalMaterial({color:window.option.color,roughness:.95,metalness:0,sheen:.75,sheenRoughness:.9,
  side:THREE.DoubleSide,transparent:window.option.opacity<1,opacity:window.option.opacity,depthWrite:window.option.opacity===1})
 const metal=new THREE.MeshStandardMaterial({color:'#665f55',roughness:.4,metalness:.6})
 const bar=(w:number,h:number,d:number,x:number,y:number,z:number)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),metal);mesh.position.set(x,y,z);root.add(mesh);return mesh}
 const geometry=window.option.kind==='roller'?new THREE.PlaneGeometry(1,1):fabricGeometry()
 const panels=(window.option.kind==='roller'?[0]:[-1,1]).map(sign=>{const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=window.option.opacity===1;mesh.receiveShadow=true;root.add(mesh);return {mesh,sign}})
 bar(window.width+.1,.025,.035,0,.03,0)
 if(window.option.kind==='roller')bar(window.width+.06,.065,.065,0,.015,0)
 else for(const sign of [-1,1])bar(.04,.065,.16,sign*window.width*.42,.025,-.045)
 const hem=window.option.kind==='roller'?bar(window.width,.025,.025,0,-window.drop,0):null
 const apply=(open:number)=>{
  const progress=Math.max(0,Math.min(1,open))
  for(const {mesh,sign} of panels){
   if(window.option.kind==='roller'){
    const drop=Math.max(.055,window.drop*(1-progress));mesh.scale.set(window.width,drop,1);mesh.position.set(0,-drop/2,0);if(hem)hem.position.y=-drop
   }else{
    const width=window.width*(.5*(1-progress)+.105*progress)
    mesh.scale.set(width,window.drop,1);mesh.position.set(sign*(window.width/2-width/2),-window.drop/2,Math.sin(progress*Math.PI)*.012)
   }
  }
 }
 apply(1)
 return {root,apply,dispose:()=>{root.traverse(o=>{if(o instanceof THREE.Mesh&&o.geometry!==geometry)o.geometry.dispose()});geometry.dispose();material.dispose();metal.dispose()}}
}
