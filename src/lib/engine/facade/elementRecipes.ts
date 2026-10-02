import type { BuildingModel } from '../buildingModel.ts'
import type { Rng } from '../massing/rng.ts'
import { freeFacadeSpans, worldPart } from './FacadeGrammar.ts'
import { ELEMENT_LIMITS as L } from './elementLimits.ts'
import type { ArchitecturalFeature, ArchitecturalFeatureType, ElementParameters, FacadeZone, FeaturePart } from './proceduralTypes.ts'

export const NEW_ELEMENTS: readonly ArchitecturalFeatureType[] = ['PERGOLA_COURT', 'FOLDED_CANOPY',
  'PERFORATED_BRICK_WALL', 'BAY_WINDOW', 'CANTILEVER_STAIR_TOWER', 'ROOF_GARDEN_EDGE',
  'SOLAR_SHADE_ROOF', 'GATE_PORTAL', 'CHIMNEY_TOWER', 'POOL_PAVILION']

export function elementFits(type: ArchitecturalFeatureType, z: FacadeZone, ground: number): boolean {
  if (z.anchorKind === 'gate') return type === 'GATE_PORTAL'
  if (z.anchorKind === 'pool-sitout') return type === 'POOL_PAVILION'
  if (z.anchorKind === 'roof-interior') return ['ROOF_GARDEN_EDGE', 'SOLAR_SHADE_ROOF'].includes(type)
  if (type === 'PERGOLA_COURT') return z.kind === 'VOID' && z.elevationMm === ground
  if (type === 'FOLDED_CANOPY') return ['PRIMARY', 'SECONDARY', 'ENTRANCE'].includes(z.kind)
  if (type === 'PERFORATED_BRICK_WALL' || type === 'BAY_WINDOW') return z.openingIds.length > 0 && z.kind !== 'ROOFLINE'
  if (type === 'CANTILEVER_STAIR_TOWER') return z.kind === 'STAIR_TOWER'
  if (type === 'CHIMNEY_TOWER') return ['SECONDARY', 'STAIR_TOWER'].includes(z.kind)
  return false
}

/** New recipes use the same local-face solids and validation as existing heroes. */
export function makeElement(type: ArchitecturalFeatureType, importance: 'hero' | 'support', z: FacadeZone,
  building: BuildingModel, rng: Rng, serial: number, availableDepth: number): ArchitecturalFeature | null {
  const id = `${importance}:${serial}:${type}`, parts: FeaturePart[] = []
  const p: ElementParameters = { widthRatio: rng.range(.65,.95), projectionMm: 0,
    rhythmCount: rng.int(4,9), pitchMm: 0, profile: rng.pick(['square','slim','paired']),
    slabEdge: rng.pick(['flat','upstand']), materialHint: rng.pick(['stone','wood','metal','wall']) }
  const add = (role: FeaturePart['role'], a: number, b: number, low: number, high: number,
    depth: number, offset: number = L.clearOffsetMm, material = p.materialHint) => {
    parts.push({ ...worldPart(z, `${id}:part:${parts.length}`, role, Math.round(a), Math.round(b),
      Math.round(low), Math.round(high), Math.round(offset), Math.round(depth)), materialHint: material })
  }
  const base = z.elevationMm, top = base + z.heightMm
  const free = freeFacadeSpans(z,building).sort((a,b) => b[1]-b[0]-(a[1]-a[0]))[0]
  const reach = Math.floor(Math.min(availableDepth,L.maximumProjectionMm,rng.range(1000,2200)))
  let a = free?.[0] ?? z.startMm + 180, b = free?.[1] ?? z.endMm - 180
  const t = p.profile === 'slim' ? 80 : p.profile === 'paired' ? 120 : 180
  if (['GATE_PORTAL','POOL_PAVILION','SOLAR_SHADE_ROOF','ROOF_GARDEN_EDGE','PERGOLA_COURT'].includes(type)) {
    a = z.startMm + 180; b = a + Math.round((z.endMm-z.startMm-360)*p.widthRatio)
    if (b-a < 1000 || reach < 600) return null
    if (type === 'GATE_PORTAL') {
      const path = building.siteFeatures?.find(f => f.id === z.sourceSiteId)
      if (!path) return null
      a = z.startMm; b = z.endMm
      if (a+t > path.rect.x || b-t < path.rect.x+path.rect.w) return null
      add('post',a,a+t,base,base+2800,250,0)
      add('post',b-t,b,base,base+2800,250,0)
      add('slab',a,b,base+2800,base+3000,1000,0)
    } else if (type === 'ROOF_GARDEN_EDGE') {
      add('box',a,b,base+160,base+560,L.roofEdgeDepthMm,160,'stone')
      add('panel',a+40,b-40,base+560,base+590,L.roofEdgeDepthMm-80,200,'wood')
    } else {
      const roofZ = type === 'SOLAR_SHADE_ROOF' ? base+2600 : top-450
      const depth = type === 'POOL_PAVILION' ? Math.min(reach,
        building.siteFeatures!.find(f=>f.id===z.sourceSiteId)!.rect.h-180) : reach
      for (const u of [a,b-t]) {
        for (const offset of [L.clearOffsetMm,depth-t]) add('post',u,u+t,base,roofZ,t,offset,
          type === 'PERGOLA_COURT' ? 'wood' : 'metal')
        if (p.profile === 'paired' && u+t+140 < b) add('post',u+t+40,u+2*t+40,base,roofZ,t,depth-t,'metal')
      }
      if (type === 'POOL_PAVILION') add('slab',a,b,roofZ,roofZ+180,depth-180,180,'wood')
      else for (let i=0;i<p.rhythmCount;i++) {
        const u=a+(b-a-t)*i/(p.rhythmCount-1)
        const dz=type==='SOLAR_SHADE_ROOF'?Math.round(i*240/(p.rhythmCount-1)):0
        add('beam',u,u+t,roofZ+dz,roofZ+dz+100,depth-180,180,type==='PERGOLA_COURT'?'wood':'metal')
      }
    }
  } else if (type === 'BAY_WINDOW' || type === 'PERFORATED_BRICK_WALL') {
    const window = building.windows.filter(w=>z.openingIds.includes(w.id!)).find(w=>
      type !== 'BAY_WINDOW' || building.rooms.some(r=>r.floorId===w.floorId &&
        (w.rooms??[]).some(id=>id===r.id||id===r.semanticId) && r.zone!=='service' && !r.outdoor))
    if (!window || reach < 700) return null
    const at = z.side==='N'||z.side==='S'?window.at.x:window.at.y
    a=at-window.width/2; b=at+window.width/2
    const lo=base+(window.sill??850), hi=base+(window.head??2600)
    if(a-100<z.startMm || b+100>z.endMm || hi+100>top) return null
    if(type==='BAY_WINDOW') {
      add('beam',a-100,b+100,lo-100,lo,reach-180,180,'wall')
      add('beam',a-100,b+100,hi,hi+100,reach-180,180,'wall')
      add('post',a-100,a,lo,hi,reach-180,180,'metal')
      add('post',b,b+100,lo,hi,reach-180,180,'metal')
      add('glass',a,b,lo,hi,24,reach-24,'glass')
    } else {
      // Sparse staggered masonry: at most 25% aperture coverage before validation.
      const pitch=(b-a)/p.rhythmCount
      for(let row=0;row<5;row++) for(let i=0;i<p.rhythmCount;i++) {
        const u=a+pitch*(i+(row%2)*.35)
        if(u+pitch*.35>b) continue
        add('screen',u,u+pitch*.35,lo+row*(hi-lo)/5,lo+row*(hi-lo)/5+80,180,350,'stone')
      }
    }
  } else {
    if(!free || b-a<1000 || reach<500) return null
    b=a+Math.max(900,Math.round((b-a)*p.widthRatio))
    if(type==='FOLDED_CANOPY') {
      // Two stepped wings meet at the high centre: editable real slab sections.
      const mid=(a+b)/2
      for(let i=0;i<6;i++) {
        const u=a+(b-a)*i/6, dz=Math.round((1-Math.abs((u+(b-a)/12-mid)/((b-a)/2)))*160)
        add('slab',u,u+(b-a)/6,top-430+dz,top-310+dz,reach-180,180,'wall')
      }
    } else if(type==='CANTILEVER_STAIR_TOWER') {
      add('post',a,a+t,base+150,top-150,reach-180,180,'metal')
      add('beam',a,b,top-250,top-150,reach-180,180,'metal')
      add('glass',a+t,b,base+250,top-250,24,reach-24,'glass')
    } else if(type==='CHIMNEY_TOWER') {
      b=a+Math.min(b-a,rng.int(600,1000))
      add('box',a,b,base+100,top-280,reach-180,180,'stone')
      add('slab',a,b,top-280,top-120,reach,0,'metal')
    }
  }
  if(!parts.length) return null
  p.widthRatio=(Math.max(...parts.map(x=>x.u1Mm))-Math.min(...parts.map(x=>x.u0Mm)))/(z.endMm-z.startMm)
  p.projectionMm=Math.max(...parts.map(x=>x.offsetMm+x.depthMm))
  p.pitchMm=Math.round((b-a)/p.rhythmCount)
  p.materialHint=parts[0].materialHint!
  return {id,type,importance,zoneIds:[z.id],parameters:p,parts}
}
