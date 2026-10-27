import test from 'node:test'
import assert from 'node:assert/strict'
import {BoxGeometry,Group,Mesh,MeshBasicMaterial,Vector3} from 'three'
import {rainSceneSampler} from '../src/lib/water/rainSceneSampler.ts'
import {createRainField,rainImpactAt,rainSurfaces} from '../src/lib/water/rainPreview.ts'
import {waterPipeCurve} from '../src/lib/water/pipeCurve.ts'

test('rain collision uses actual translated ground, roof and overhang mesh heights without changing source',()=>{
 const source=new Group(),material=new MeshBasicMaterial(),geometry=new BoxGeometry(10,.2,10)
 const ground=new Mesh(geometry,material);ground.position.set(5,.35,-5);source.add(ground)
 const roof=new Mesh(new BoxGeometry(4,.2,4),material);roof.position.set(3,6.35,-3);source.add(roof)
 const port=new Mesh(new BoxGeometry(1,1,1),material);port.name='Roof_WaterTank_1_body';port.position.set(3,8,-3);source.add(port)
 source.updateWorldMatrix(true,true);const before=source.toJSON(),collision=rainSceneSampler(source)
 assert.ok(Math.abs(collision.heightAt(7000,7000)-450)<.001)
 assert.ok(Math.abs(collision.heightAt(3000,3000)-6450)<.001)
 assert.equal(collision.heightAt(12000,12000),0)
 assert.deepEqual(source.toJSON(),before)
 collision.dispose();geometry.dispose();roof.geometry.dispose();port.geometry.dispose();material.dispose()
})
test('every rain endpoint stays above the rendered site and house, with no wind path into walls',()=>{
 const building={planId:'rain-collision-test',plot:{widthMm:10000,depthMm:10000},floors:[{id:'GF',level:0,elevationMm:0,heightMm:3000,footprint:[{x:1000,y:1000,w:5000,h:5000}]}],shafts:[]}
 const source={highestM:4,heightAt:(x,y)=>x>=1000&&x<=6000&&y>=1000&&y<=6000?4000:450}
 const field=createRainField(building,[],1,null,source)
 for(const drop of field.drops){const [x,y,z]=drop.impact;assert.ok(y>=source.heightAt(x*1000,-z*1000)/1000+.0249);assert.deepEqual(drop.wind,[0,0]);assert.ok(y>0)}
})
test('weather shields indoor service shafts while preserving the open exterior courtyard',()=>{
 const building={planId:'roof',plot:{widthMm:10000,depthMm:10000},floors:[{id:'GF',level:0,elevationMm:0,heightMm:3000,footprint:[{x:0,y:0,w:8000,h:8000}],courtyard:{x:3000,y:3000,w:2000,h:2000}}],shafts:[{floorId:'GF',rect:{x:1000,y:1000,w:500,h:500}}]}
 const surfaces=rainSurfaces(building,[],1,null)
 assert.equal(rainImpactAt(surfaces,1250,1250).topMm,3000)
 assert.equal(rainImpactAt(surfaces,4000,4000).topMm,0)
})
test('pipe-water bends retain exact connection ports, stay in the route envelope and remove sharp corners',()=>{
 const points=[{x:0,y:0,z:2000},{x:0,y:0,z:1000},{x:1000,y:0,z:1000},{x:1000,y:1000,z:1000}],before=JSON.stringify(points)
 const curve=waterPipeCurve(points,90)
 assert.ok(curve.getPoint(0).distanceTo(new Vector3(0,2,0))<1e-8)
 assert.ok(curve.getPoint(1).distanceTo(new Vector3(1,1,-1))<1e-8)
 assert.equal(curve.curves.filter(c=>c.type==='QuadraticBezierCurve3').length,2)
 for(const p of curve.getPoints(100)){assert.ok(p.x>=-1e-9&&p.x<=1+1e-9);assert.ok(p.y>=1-1e-9&&p.y<=2+1e-9);assert.ok(p.z>=-1-1e-9&&p.z<=1e-9)}
 assert.equal(JSON.stringify(points),before)
})
