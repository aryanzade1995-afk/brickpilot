import * as THREE from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {rectUnionEdges,type Rect} from '../geometry.ts'
import {uncoveredRects} from '../engine/planner/projections.ts'
import type {BuildingModel} from '../engine/buildingModel.ts'

/** Matches Blender's masonry perimeter and earth infill, never solid concrete. */
export function plinthEnclosure(building:BuildingModel){
 const floor=[...building.floors].sort((a,b)=>a.level-b.level)[0]
 if(!floor)return null
 const grade=floor.elevationMm-(building.structuralSizing?.plinthHeightMm??400)
 const top=floor.elevationMm-(floor.slabThicknessMm??180)
 if(top<=grade)return null
 const earth=uncoveredRects(floor.footprint,floor.courtyard?[floor.courtyard]:[])
 const masonry:Rect[]=[]
 for(const edge of rectUnionEdges(earth)){
  const horizontal=edge.a.y===edge.b.y
  const rect=horizontal?{x:edge.a.x-130,y:edge.a.y-130,w:edge.b.x-edge.a.x+260,h:260}:
   {x:edge.a.x-130,y:edge.a.y-130,w:260,h:edge.b.y-edge.a.y+260}
  // Disjoint strips avoid overlapping faces and flickering at corners.
  masonry.push(...uncoveredRects([rect],masonry))
 }
 return {grade:grade-20,top,earth,masonry}
}

/** Old cached villas receive the same enclosure immediately. New exports
 * already contain it, so no duplicate layer or rebuild is required. */
export function buildPlinthEnclosureGroup(building:BuildingModel,source:THREE.Object3D){
 const root=new THREE.Group();root.name='Default_plinth_enclosure'
 const present=new Set<string>();let wall:THREE.Material|undefined
 source.traverse(o=>{
  if(o.userData.construction_role)present.add(o.userData.construction_role)
  if(/^Plinth_Masonry/.test(o.name))present.add('masonry-plinth-enclosure')
  if(/^Plinth_CompactedEarth/.test(o.name))present.add('compacted-earth-fill')
  if(o instanceof THREE.Mesh&&(o.userData.material_role==='secondary_wall'||!wall&&o.userData.material_role==='wall'))wall=Array.isArray(o.material)?o.material[0]:o.material
 })
 const data=plinthEnclosure(building)
 if(data)for(const [role,rects] of [['compacted-earth-fill',data.earth],['masonry-plinth-enclosure',data.masonry]] as const){
  if(present.has(role)||!rects.length)continue
  const parts=rects.map(r=>new THREE.BoxGeometry(r.w/1000,(data.top-data.grade)/1000,r.h/1000)
   .translate((r.x+r.w/2)/1000,(data.top+data.grade)/2000,-(r.y+r.h/2)/1000))
  const geometry=mergeGeometries(parts);parts.forEach(p=>p.dispose());if(!geometry)continue
  const material=role==='masonry-plinth-enclosure'&&wall?wall.clone():new THREE.MeshStandardMaterial({color:role==='compacted-earth-fill'?'#75634e':'#d1cabc',roughness:.95})
  const mesh=new THREE.Mesh(geometry,material);mesh.name=role;mesh.castShadow=true;mesh.receiveShadow=true
  mesh.userData.construction_role=role;mesh.userData.source_plan_id=building.planId
  root.add(mesh)
 }
 return {root,dispose:()=>root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose())}})}
}
