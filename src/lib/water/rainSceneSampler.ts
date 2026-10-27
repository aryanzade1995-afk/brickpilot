import { Box3, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3, type Object3D } from 'three'

/** One-time, bucketed vertical collision queries against the accepted GLB.
 * Shares source buffers without altering its materials or transforms. */
export function rainSceneSampler(source:Object3D) {
  source.updateWorldMatrix(true,true)
  const material=new MeshBasicMaterial({side:DoubleSide}),buckets=new Map<string,{mesh:Mesh;box:Box3}[]>(),size=2
  let highest=0
  source.traverse(o=>{
    if(!(o instanceof Mesh)||/Roof_WaterTank_|Service_|Formstead_Service/i.test(o.name))return
    const mesh=new Mesh(o.geometry,material);mesh.matrixAutoUpdate=false;mesh.matrix.copy(o.matrixWorld);mesh.matrixWorld.copy(o.matrixWorld)
    const box=new Box3().setFromObject(mesh)
    if(box.isEmpty()||![box.min.x,box.min.y,box.min.z,box.max.x,box.max.y,box.max.z].every(Number.isFinite))return
    highest=Math.max(highest,box.max.y)
    for(let x=Math.floor(box.min.x/size);x<=Math.floor(box.max.x/size);x++)for(let z=Math.floor(box.min.z/size);z<=Math.floor(box.max.z/size);z++){
      const key=`${x}:${z}`,list=buckets.get(key)??[];list.push({mesh,box});buckets.set(key,list)
    }
  })
  const ray=new Raycaster(),down=new Vector3(0,-1,0)
  return {highestM:highest,heightAt:(xMm:number,yMm:number)=>{
    const x=xMm/1000,z=-yMm/1000
    ray.set(new Vector3(x,highest+2,z),down)
    let height=0
    for(const {mesh,box}of buckets.get(`${Math.floor(x/size)}:${Math.floor(z/size)}`)??[]){
      if(x<box.min.x||x>box.max.x||z<box.min.z||z>box.max.z||box.max.y<height)continue
      const hits=ray.intersectObject(mesh,false);if(hits.length)height=Math.max(height,hits[0].point.y)
    }
    return height*1000
  },dispose:()=>material.dispose()}
}
