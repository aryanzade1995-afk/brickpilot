import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {Group,Scene,Mesh,BoxGeometry,MeshStandardMaterial,MeshPhysicalMaterial,Texture,RectAreaLight,Box3,PerspectiveCamera,Vector3} from 'three'
import {PHOTO_MAP_NAMES,photoMaps,refinePhotoSurfaces,photoCameraPose} from '../src/lib/three/photoExterior.ts'
import {raytraceScene} from '../src/lib/three/raytraceScene.ts'

test('photographic finishes preserve house buffers, world extents, selected colours and cached assets',()=>{
 const root=new Group(),wall=new MeshStandardMaterial({name:'Arch_primary_wall',color:'#87a591'}),glass=new MeshPhysicalMaterial({name:'Arch_glass',transmission:.7,opacity:.6,transparent:true,roughness:.3})
 const geometry=new BoxGeometry(4,3,.2),a=new Mesh(geometry,wall),b=new Mesh(geometry,glass);b.position.x=5;root.add(a,b)
 const source=PHOTO_MAP_NAMES.map(()=>new Texture()),maps=photoMaps(source,16),before=new Box3().setFromObject(root),color=wall.color.getHex()
 const result=refinePhotoSurfaces(root,maps.maps)
 assert.equal(result.count,2);assert.equal(a.geometry,geometry);assert.equal(a.material.color.getHex(),color)
 assert.equal(wall.normalMap,null);assert.notEqual(a.material,wall);assert.equal(a.material.normalMap,maps.maps['painted_plaster_wall-nor_gl'])
 assert.equal(b.material.opacity,1);assert.equal(b.material.transparent,false);assert.ok(b.material.transmission>=.94);assert.equal(glass.opacity,.6);assert.equal(glass.transmission,.7)
 assert.ok(before.equals(new Box3().setFromObject(root)))
 let sourceDisposed=false;source[0].addEventListener('dispose',()=>sourceDisposed=true)
 result.restore();maps.dispose();assert.equal(a.material,wall);assert.equal(b.material,glass);assert.equal(sourceDisposed,false)
 assert.equal(source[0].repeat.x,1)
})
test('HDR sky and actual room emitters survive the tracing snapshot without disposing shared lighting',()=>{
 const source=new Scene(),hdr=new Texture();source.userData.photographicExterior=true;source.environment=source.background=hdr;source.environmentIntensity=.65;source.environmentRotation.y=.6
 const light=new RectAreaLight('#ffcf99',18,.65,.65);light.position.set(4,2.7,-5);light.userData.photographicLight=true;source.add(light)
 let disposed=false;hdr.addEventListener('dispose',()=>disposed=true)
 const snapshot=raytraceScene(source,true)
 assert.equal(snapshot.scene.environment,hdr);assert.equal(snapshot.scene.background,hdr);assert.equal(snapshot.scene.environmentIntensity,.65);assert.equal(snapshot.scene.environmentRotation.y,.6)
 const copy=snapshot.scene.children.find(o=>o.userData.photographicLight);assert.ok(copy);assert.notEqual(copy,light);assert.equal(copy.intensity,18)
 assert.equal(snapshot.scene.children.filter(o=>o instanceof RectAreaLight).length,1,'HDR sunlight must not be duplicated by a remote artificial emitter')
 snapshot.dispose();assert.equal(disposed,false)
})
test('untextured glTF walls receive private UVs while source positions, topology and geometry ownership remain intact',()=>{
 const root=new Group(),geometry=new BoxGeometry(4,3,.2);geometry.deleteAttribute('uv')
 const material=new MeshStandardMaterial({name:'Arch_primary_wall',color:'#dddfd7'}),wall=new Mesh(geometry,material);wall.position.set(3,2,-4);root.add(wall)
 const positions=Array.from(geometry.attributes.position.array),indices=Array.from(geometry.index.array),maps=photoMaps(PHOTO_MAP_NAMES.map(()=>new Texture()))
 let sourceDisposed=false;geometry.addEventListener('dispose',()=>sourceDisposed=true)
 const result=refinePhotoSurfaces(root,maps.maps)
 assert.notEqual(wall.geometry,geometry);assert.ok(wall.geometry.getAttribute('uv'));assert.equal(geometry.getAttribute('uv'),undefined)
 assert.deepEqual(Array.from(wall.geometry.attributes.position.array),positions);assert.deepEqual(Array.from(wall.geometry.index.array),indices)
 assert.ok(Array.from(wall.geometry.attributes.uv.array).every(Number.isFinite));result.restore();maps.dispose()
 assert.equal(wall.geometry,geometry);assert.equal(wall.material,material);assert.equal(sourceDisposed,false)
})
test('architectural framing is finite for wide and portrait displays and follows actual building bounds',()=>{
 const building={floors:[{footprint:[{x:1000,y:2000,w:10000,h:14000}],elevationMm:0,heightMm:3000},{footprint:[{x:1000,y:2000,w:10000,h:14000}],elevationMm:3000,heightMm:3000}]}
 for(const aspect of [.6,1,16/9]){const pose=photoCameraPose(building,aspect);assert.equal(pose.fov,36);assert.equal(pose.target.x,6);assert.equal(pose.target.z,-9);assert.ok(pose.position.toArray().every(Number.isFinite));assert.ok(pose.position.z<pose.target.z)}
 assert.ok(photoCameraPose(building,.6).position.distanceTo(photoCameraPose(building,.6).target)>photoCameraPose(building,16/9).position.distanceTo(photoCameraPose(building,16/9).target))
 const bounds=new Box3(new Vector3(-2,-2,-23),new Vector3(19,9,1))
 for(const aspect of [.6,1,16/9]){
  const pose=photoCameraPose(building,aspect,bounds),camera=new PerspectiveCamera(pose.fov,aspect,.1,400)
  camera.position.copy(pose.position);camera.lookAt(pose.target);camera.updateMatrixWorld(true)
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [-.35,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
   const projected=new Vector3(x,y,z).project(camera);assert.ok(Math.abs(projected.x)<1);assert.ok(Math.abs(projected.y)<1)
  }
 }
})
test('all photographic assets match verified source checksums and ship locally',async()=>{
 const root=new URL('../public/exterior-assets/photo/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'))
 assert.equal(manifest.length,13)
 for(const item of manifest){const bytes=await readFile(new URL(item.file,root));assert.equal(bytes.length,item.bytes);assert.equal(createHash('md5').update(bytes).digest('hex'),item.md5);assert.equal(item.license,'CC0-1.0')}
})
test('vegetation assets retain licensed source records and bounded browser geometry',async()=>{
 const root=new URL('../public/exterior-assets/photo/',import.meta.url),manifest=JSON.parse(await readFile(new URL('vegetation-manifest.json',root),'utf8'))
 assert.equal(manifest.length,2)
 for(const item of manifest){
  const bytes=await readFile(new URL(item.file,root));assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);assert.equal(item.license,'CC0-1.0')
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'))
  const triangles=gltf.meshes.flatMap(m=>m.primitives).reduce((total,p)=>total+gltf.accessors[p.indices].count/3,0)
  assert.ok(triangles<=item.triangleBudget+10);assert.ok(triangles>1000)
 }
})
