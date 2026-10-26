import { Group, Matrix4, Mesh, Vector3, type Object3D } from 'three'
import type { VillaPlumbing } from '../plumbing/villaPlumbing.ts'
import { planToThreeGlb } from '../solar/coordinates.ts'

/** Preserve the exact accepted Blender tank parts and scale about each tank's
 * base. Geometry and original materials remain shared and unmodified. */
export function separateTankModels(source:Object3D) {
  source.updateMatrixWorld(true)
  const root=new Group(),parts:{mesh:Mesh;matrix:Matrix4;id:string}[]=[]
  root.name='Resizable_Accepted_Roof_Tanks'
  source.traverse(o=>{if(!(o instanceof Mesh))return;const id=o.name.match(/^(Roof_WaterTank_\d+)(?:_|$)/)?.[1];if(!id)return
    const mesh=o.clone(false);mesh.matrixAutoUpdate=false;mesh.matrix.copy(o.matrixWorld);root.add(mesh);parts.push({mesh,matrix:o.matrixWorld.clone(),id})
  })
  return {root,parts}
}
export function sizeTankModels(models:ReturnType<typeof separateTankModels>,ports:VillaPlumbing['tankPorts'],diameterScale:number,heightScale:number) {
  if(!Number.isFinite(diameterScale)||diameterScale<.5||diameterScale>1||!Number.isFinite(heightScale)||heightScale<.5||heightScale>1.5)throw new RangeError('Invalid roof tank dimensions')
  for(const part of models.parts){const port=ports.find(p=>p.id===part.id);part.mesh.visible=Boolean(port);if(!port)continue
    const base=planToThreeGlb({...port.center,z:port.center.z-200}),p=new Vector3(base.x,base.y,base.z)
    const transform=new Matrix4().makeTranslation(p.x,p.y,p.z).multiply(new Matrix4().makeScale(diameterScale,heightScale,diameterScale)).multiply(new Matrix4().makeTranslation(-p.x,-p.y,-p.z))
    part.mesh.matrix.copy(transform.multiply(part.matrix));part.mesh.matrixWorldNeedsUpdate=true
  }
  models.root.updateMatrixWorld(true)
}
