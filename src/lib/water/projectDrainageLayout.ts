import type {ProjectPipelines} from './projectPipelines.ts'
import type {VillaPipe,VillaPlumbing,PipeSegment} from '../plumbing/villaPlumbing.ts'
import {drainNetworkSegments} from './drainageNetwork.ts'
import {pipeAssembly} from '../plumbing/assembly.ts'
import {fixtureWasteConnection} from './fixtureDrainage.ts'

/** Massing uses one assembly for main pipes, fixture drops and branches. Shared
 * ports are split before fitting placement, so a tee replaces the bend at a
 * junction instead of overlaying independently rounded tubes. No second route. */
export function projectDrainageLayout(network:ProjectPipelines):VillaPlumbing {
 const configured=network.fixtureScene.configuredDischarge
 const pipes:VillaPipe[]=[...(configured?network.home.pipes.filter(p=>p.system!=='water'):network.drainNetwork.layout.pipes)]
 for(const fixture of network.fixtureScene.fixtures){
  const branch=fixture.branch
  if(!branch || branch.blocked || !configured&&!branch.connected)continue
  const base={system:'drain' as const,shaftId:branch.shaftId,floorId:fixture.floorId,sizeBasis:'selected outside diameter' as const}
  pipes.push({...base,id:`fixture-branch:${fixture.key}`,purpose:branch.reason,diameterMm:branch.diameterMm,points:branch.points})
  pipes.push({...base,id:`fixture-outlet:${fixture.key}`,purpose:'Canonical fixture waste connection',diameterMm:fixture.kind==='toilet'?branch.diameterMm:Math.min(branch.diameterMm,50),points:fixtureWasteConnection(fixture)})
 }
 for(const collector of network.fixtureScene.collectors){
  if(!configured||collector.blocked)continue
  pipes.push({id:collector.id,system:'drain',shaftId:null,floorId:'saved-discharge',sizeBasis:'selected outside diameter',purpose:'Saved 2D discharge collector; surveyed levels require review',diameterMm:collector.diameterMm,points:collector.points})
 }
 // The modular fitting kit handles orthogonal junctions. Retain exact surveyed
 // falls as straight inclined cylinders, rather than flattening their elevation.
 const orthogonal:VillaPipe[]=[],sloping:PipeSegment[]=[]
 for(const pipe of pipes)for(let i=1;i<pipe.points.length;i++){
  const from=pipe.points[i-1],to=pipe.points[i]
  const changed=['x','y','z'].filter(a=>Math.abs(from[a as keyof typeof from]-to[a as keyof typeof to])>.01).length
  if(changed>1)sloping.push({system:pipe.system,diameterMm:pipe.diameterMm,from,to})
  else if(changed)orthogonal.push({...pipe,id:`${pipe.id}:${i}`,points:[from,to]})
 }
 const straight=drainNetworkSegments(orthogonal),segments=[...straight,...sloping],assembly=pipeAssembly(straight)
 assembly.tubes.push(...sloping)
 // Include branch geometry: changing a fixture must invalidate the live overlay
 // even when the accepted building and main-stack signature stay unchanged.
 const signature=JSON.stringify([network.drainNetwork.layout.signature,pipes.map(p=>[p.id,p.diameterMm,p.points])])
 return {...network.drainNetwork.layout,pipes,segments,assembly,signature}
}
