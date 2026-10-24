import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Box3, Vector3, Texture } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { prepareVillaScene } from '../src/lib/three/prepareVillaScene.ts'
const [file,layoutFile]=process.argv.slice(2)
const bytes=readFileSync(file),layout=JSON.parse(readFileSync(layoutFile))
// Geometry/metadata QA in Node: browser texture loading is checked in the UI.
const loader=new GLTFLoader().register(()=>({name:'GEOMETRY_QA',loadTexture:()=>Promise.resolve(new Texture())}))
const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
let services=0,building=0
const bounds=new Box3()
scene.traverse(o=>{if(o.isMesh){if(o.userData.formstead_plumbing){assert.equal(o.userData.source_plan_id,layout.planId);bounds.expandByObject(o);services++}else building++}})
assert.ok(services>0&&building>0,'Both building and pipes must load')
const expected=new Box3()
for(const p of layout.pipes)for(const point of p.points){const r=p.diameterMm*.00055;expected.expandByPoint(new Vector3(point.x*.001-r,point.z*.001-r,-point.y*.001-r));expected.expandByPoint(new Vector3(point.x*.001+r,point.z*.001+r,-point.y*.001+r))}
assert.ok(bounds.min.distanceTo(expected.min)<.01&&bounds.max.distanceTo(expected.max)<.01,'GLB must use the canonical axis transform and elevations')
const prepared=prepareVillaScene(scene,1);let duplicate=0;prepared.traverse(o=>{if(o.userData.formstead_plumbing)duplicate++});assert.equal(duplicate,0,'Viewer must strip baked services before adding one current layer')
console.log(JSON.stringify({file,planId:layout.planId,buildingMeshes:building,serviceMeshes:services,canonicalBoundsMatch:true,reopenWithoutDuplicates:true}))
