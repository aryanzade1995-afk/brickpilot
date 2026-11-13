import type {BuildingModel} from '../engine/buildingModel.ts'

/** Display context only. Metres, X east / Y up / Z north, like the accepted GLB.
 * Road follows recorded plan frontage; no geographic north/sun study is inferred.
 * Grade matches Blender geometry/site.py and the selected plinth height.
 */
export function siteContext(building:BuildingModel){
 const width=building.plot.widthMm/1000,depth=building.plot.depthMm/1000
 if(!Number.isFinite(width)||!Number.isFinite(depth)||width<=0||depth<=0)throw new Error('Valid plot dimensions are needed for the surroundings view.')
 const grade=(Math.min(...building.floors.map(f=>f.elevationMm))-(building.structuralSizing?.plinthHeightMm??400))/1000
 return {width,depth,grade,centerX:width/2,roadZ:-depth-6,roadLength:Math.max(120,width*5),
  trees:[[-4,-4],[width+4,-4],[-4,-depth+4],[width+4,-depth+4],[width*.25,-depth-16],[width*.8,-depth-16]],
  homes:[{x:-11,z:-depth*.6,w:8,d:10,h:5.6},{x:width+11,z:-depth*.6,w:8,d:10,h:6.4},
   {x:width*.25-3,z:-depth-24,w:8,d:9,h:5.8},{x:width*.8+5,z:-depth-25,w:9,d:10,h:6.2}]}
}
