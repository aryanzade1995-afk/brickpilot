import {Box3,CylinderGeometry,Matrix4,Mesh,MeshStandardMaterial,SphereGeometry,type Object3D} from 'three'
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Two-sided hardware stays attached to the moving leaf. One draw per door. */
export function addDoorKnobs(root:Object3D,box:Box3,horizontal:boolean,hinge:'a'|'b',doorId:string){
 const along=horizontal?0:2,normal=horizontal?2:0
 const lo=box.min.toArray(),hi=box.max.toArray()
 const latch=hinge==='a'?hi[along]-.085:lo[along]+.085
 const height=Math.min(hi[1]-.18,lo[1]+1.0),parts=[]
 for(const sign of [-1,1]){
  const surface=sign<0?lo[normal]:hi[normal]
  for(const [radius,length,offset] of [[.027,.006,.004],[.009,.026,.02],[.022,0,.042]]){
   const g=length?new CylinderGeometry(radius,radius,length,16):new SphereGeometry(radius,16,10)
   if(horizontal)g.rotateX(Math.PI/2);else g.rotateZ(Math.PI/2)
   const p=[0,height,0];p[along]=latch;p[normal]=surface+sign*offset
   g.translate(p[0],p[1],p[2]);parts.push(g)
  }
 }
 const geometry=mergeGeometries(parts,false)!
 parts.forEach(p=>p.dispose());root.updateWorldMatrix(true,false)
 geometry.applyMatrix4(new Matrix4().copy(root.matrixWorld).invert())
 const knob=new Mesh(geometry,new MeshStandardMaterial({color:'#91999f',metalness:.85,roughness:.23}))
 knob.name=`Walkthrough_Knobs_${doorId}`;knob.userData={walkthroughDoorId:doorId,doorHardware:true}
 knob.castShadow=knob.receiveShadow=true;root.add(knob);return knob
}
