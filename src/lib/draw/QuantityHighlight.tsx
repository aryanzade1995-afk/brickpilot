import type { FloorPlan, SiteFeature } from '../engine/types.ts'
import type { CanonicalModel } from '../model/canonical.ts'
import { drawingStructure } from '../engine/structuralSizing.ts'
import type { Rect } from '../geometry.ts'

/** A drawing overlay from source geometry, never a change to the plan. */
export function QuantityHighlight({ floor, model, siteFeatures, category }: { floor: FloorPlan; model: CanonicalModel; siteFeatures?: SiteFeature[]; category: string }) {
  const s = drawingStructure(floor, model), color = '#b16c24'
  let rects: Rect[] = [], lines: { a: { x: number; y: number }; b: { x: number; y: number }; width?: number }[] = []
  if (category === 'external.compoundWall') lines = [
    { a: { x: 0, y: 0 }, b: { x: model.plot.width, y: 0 } },
    { a: { x: model.plot.width, y: 0 }, b: { x: model.plot.width, y: model.plot.depth } },
    { a: { x: model.plot.width, y: model.plot.depth }, b: { x: 0, y: model.plot.depth } },
    { a: { x: 0, y: model.plot.depth }, b: { x: 0, y: 0 } },
  ]
  else if (/earthwork\.(plinthFilling|antiTermite)/.test(category)) rects = floor.footprint
  else if (category.includes('footings') || category.startsWith('earthwork.')) rects = (s.footings ?? []).map(f => f.rect)
  else if (category.includes('plinthBeams')) lines = (s.plinthBeams ?? []).map(b => ({ ...b, width: b.widthMm }))
  else if (category.includes('columns')) rects = s.columns.map(c => ({ x: c.at.x - c.size / 2, y: c.at.y - c.size / 2, w: c.size, h: c.size }))
  else if (category.includes('beams')) lines = s.beams.map(b => ({ ...b, width: b.widthMm }))
  else if (/doors|windows|glazing|grills|lintels|chajjas/.test(category)) lines = floor.openings.filter(o => /doors/.test(category) ? o.kind !== 'window' : /windows|glazing|grills|chajjas/.test(category) ? o.kind === 'window' : true).map(o => ({ a: { x: o.at.x - (o.orient === 'h' ? o.width / 2 : 0), y: o.at.y - (o.orient === 'v' ? o.width / 2 : 0) }, b: { x: o.at.x + (o.orient === 'h' ? o.width / 2 : 0), y: o.at.y + (o.orient === 'v' ? o.width / 2 : 0) }, width: 180 }))
  else if (category.includes('stairs')) rects = floor.stair ? [floor.stair.rect] : []
  else if (/masonry|plaster.walls|paint|skirting|parapet|compoundWall/.test(category)) lines = floor.walls.filter(w => category.endsWith('.115') ? w.thickness < 200 : category.endsWith('.230') ? w.thickness >= 200 && w.kind !== 'parapet' : category.includes('parapet') ? w.kind === 'parapet' : true).map(w => ({ ...w, width: w.thickness }))
  else if (category.startsWith('external.')) {
    const kind = category.split('.')[1]
    rects = (siteFeatures ?? []).filter(f => kind === 'paving' ? ['parking', 'path', 'sitOut', 'utilityYard'].includes(f.kind) : f.kind === kind).map(f => f.rect)
  } else if (category.includes('balconies')) rects = floor.rooms.filter(r => r.outdoor).map(r => r.rect)
  else if (category.startsWith('flooring.')) { const id = category.slice('flooring.'.length); rects = floor.rooms.filter(r => r.semanticId === id || r.id === id).map(r => r.rect) }
  else if (/wetRooms|baths/.test(category)) rects = floor.rooms.filter(r => /bath|toilet|ensuite/i.test(`${r.semanticId} ${r.name}`)).map(r => r.rect)
  else if (category.includes('kitchenDado')) rects = floor.rooms.filter(r => /kitchen/i.test(r.name)).map(r => r.rect)
  else if (/electrical|plumbing/.test(category)) rects = floor.rooms.filter(r => !r.outdoor).map(r => r.rect)
  else rects = floor.footprint
  return <g data-layer="quantity-highlight" data-quantity={category} pointerEvents="none" stroke={color} strokeWidth={65} fill={color} fillOpacity={0.14}>
    {rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} />)}
    {lines.map((l, i) => <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} strokeWidth={Math.max(85, l.width ?? 85)} strokeOpacity={0.75} />)}
  </g>
}
