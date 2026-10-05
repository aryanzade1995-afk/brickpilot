import type { Design } from '../engine/types.ts'
import type { Brief } from '../model/brief.ts'
import { createFinishAssignments } from '../cost/finishAssignments.ts'
import { resolveSpecification, specsCatalogue } from '../cost/catalogue.ts'
import { paintColour } from '../finishes/paint.ts'
import { optionImage } from '../finishes/optionImage.ts'
import { toneOf } from '../render/roomSpecs.ts'

/* ------------------------------------------------------------------ *
 *  What the person chose on Finishes & Cost, resolved for ONE room, in the
 *  form the 360 renderer draws: real product textures where the catalogue
 *  has a surface photo, the product's photo for fixtures (its colour is read
 *  from it), and the plan's own rules for where each item is fitted.
 *  Nothing is invented: every value comes from the Brief's specification
 *  overrides, or the finish level's preset where the person left an item alone.
 * ------------------------------------------------------------------ */

type Pattern = 'image' | 'tile' | 'plank' | 'subway' | 'mosaic' | 'large'
export type Surface = { name: string; color: string; image?: string; tileM: number; pattern: Pattern; rough: number }
export type InteriorFinishes = {
  walls: { color: string; paint: string }
  floor: Surface
  wallTiles?: Surface & { zone: 'full' | 'backsplash'; heightM: number }
  ceiling: { type: 'plain' | 'false' | 'cove' | 'tray' | 'wooden'; color: string; name: string }
  counter?: Surface
  cabinets?: { name: string; color: string; image?: string; gloss: boolean; glass: boolean }
  door: { name: string; color: string; image?: string; glass: boolean }
  windowFrame: { name: string; color: string }
  sanitary?: { name: string; wc: 'floor' | 'wall' | 'indian'; image?: string }
  fittings?: { name: string; finish: 'chrome' | 'black' | 'gold'; image?: string }
  waterHeater?: { name: string; kind: 'storage' | 'instant'; image?: string }
  exhaust?: { name: string; image?: string }
  fan?: { name: string; style: 'plain' | 'chandelier' | 'underlight'; image?: string }
  lights: { name: string; kind: 'downlight' | 'panel' | 'surface'; image?: string }
  batten?: { name: string; image?: string }
  bulb?: { name: string; image?: string }
  switches: { name: string; image?: string }
  /** what the panel lists, in the person's words */
  summary: { label: string; value: string; image?: string }[]
}

const surfaceOf = (name: string, image: string | undefined, kind: 'floor' | 'wall' | 'counter'): Surface => {
  const tone = toneOf(name)
  const plank = /wood|teak|walnut|oak|laminate/i.test(name)
  const pattern: Pattern = image ? 'image' : /subway|brick/i.test(name) ? 'subway' : /mosaic|terrazzo/i.test(name) ? 'mosaic'
    : /large-format|large format|slab|marble|quartz|onyx/i.test(name) ? 'large' : plank ? 'plank' : 'tile'
  const tileM = kind === 'counter' ? 1.2 : /large|slab|marble|gvt|italian|onyx|statuario|calacatta/i.test(name) ? 1.2 : plank ? 1.2 : kind === 'wall' ? 0.6 : 0.8
  const rough = /polish|marble|gvt|onyx|statuario|calacatta|quartz|granite|glossy|subway/i.test(name) ? 0.14 : plank ? 0.45 : /matt|anti-skid|stone|kota|sandstone|concrete/i.test(name) ? 0.6 : 0.3
  return { name, color: tone.hex, image, tileM, pattern, rough }
}

const HABITABLE = /living|dining|bed|study|family|lounge|guest|home.?office|media|puja|pooja|office/i

export function interiorFinishes(design: Design, floorLevel: number, roomId: string): InteriorFinishes | null {
  const brief = design.model.brief as Brief
  const room = design.floors.find((f) => f.level === floorLevel)?.rooms.find((r) => r.id === roomId)
  if (!room || !brief?.specs) return null
  const roomKey = `${floorLevel}:${room.semanticId ?? roomId}`
  const semantic = room.semanticId ?? roomId
  const assigned = new Set((createFinishAssignments(design, brief).rooms.find((r) => r.id === roomKey)?.finishes ?? []).map((f) => f.item))
  const label = (item: string) => specsCatalogue.items.find((i) => i.id === item)?.label ?? item
  const pick = (item: string, perRoom = true) => {
    if (!specsCatalogue.items.some((i) => i.id === item)) return null
    const option = perRoom ? resolveSpecification(brief, item, brief.specs.overrides[`${item}@${roomKey}`] === undefined ? semantic : roomKey) : resolveSpecification(brief, item)
    const image = optionImage(option)
    // a fixture's picture is only its product photo, never a stand-in material texture
    return { option, image: image?.src, surface: !!image?.surface, photo: image && !image.surface ? image.src : undefined }
  }
  const summary: InteriorFinishes['summary'] = []
  const note = (item: string, value: string, image?: string) => summary.push({ label: label(item), value, image })
  const wet = /bath|toilet|wc|powder/i.test(roomId), kitchen = /kitchen/i.test(roomId)

  const paint = paintColour(brief, roomKey)
  note('interior-paint', paint.label)

  const floorItem = ['floor-living', 'floor-bedrooms', 'floor-kitchen', 'floor-bathrooms', 'floor-other'].find((i) => assigned.has(i)) ?? 'floor-other'
  const fl = pick(floorItem)!
  const floor = surfaceOf(fl.option.name, fl.surface ? fl.image : undefined, 'floor')
  note(floorItem, fl.option.name, fl.image)

  let wallTiles: InteriorFinishes['wallTiles']
  const tileItem = wet ? 'bath-wall-tiles' : kitchen ? 'kitchen-wall-tiles' : null
  if (tileItem && assigned.has(tileItem)) {
    const t = pick(tileItem)!
    wallTiles = { ...surfaceOf(t.option.name, t.surface ? t.image : undefined, 'wall'), zone: wet ? 'full' : 'backsplash', heightM: wet ? 2.1 : 0.6 }
    note(tileItem, t.option.name, t.image)
  }

  const c = pick('false-ceiling')!
  const cn = `${c.option.id} ${c.option.name}`
  const ceilingType: InteriorFinishes['ceiling']['type'] = /none|no false/i.test(cn) ? 'plain' : /cove/i.test(cn) ? 'cove'
    : /tray|coffer/i.test(cn) ? 'tray' : /slat|timber|hybrid|wood/i.test(cn) ? 'wooden' : 'false'
  const ceiling = { type: ceilingType, color: '#F6F4F0', name: c.option.name }
  note('false-ceiling', c.option.name)

  let counter: InteriorFinishes['counter'], cabinets: InteriorFinishes['cabinets']
  if (kitchen) {
    const k = pick('kitchen-counter', false)!
    counter = surfaceOf(k.option.name, k.surface ? k.image : undefined, 'counter')
    note('kitchen-counter', k.option.name, k.image)
    const cb = pick('kitchen-cabinets', false)!
    const name = cb.option.name
    cabinets = { name, image: cb.surface ? cb.image : undefined, gloss: /acrylic|pu|gloss|membrane/i.test(name), glass: /glass/i.test(name),
      color: /acrylic|pu-painted|pu |membrane/i.test(name) ? '#F1EFEA' : /matt/i.test(name) ? '#5E6467' : /laminate|handleless/i.test(name) ? '#D9D5CE' : toneOf(name).hex }
    note('kitchen-cabinets', name, cb.image)
  }

  const d = pick('internal-door', false)!
  const door = { name: d.option.name, image: d.surface ? d.image : undefined, glass: /glass/i.test(d.option.name),
    color: /paint|pvc|upvc|white/i.test(d.option.name) ? '#EEEBE4' : /dark|walnut|flush doors/i.test(d.option.name) ? '#5A3B2A' : toneOf(d.option.name).hex }
  note('internal-door', d.option.name, d.image)
  const w = pick('windows', false)!
  const windowFrame = { name: w.option.name, color: /upvc/i.test(w.option.name) ? '#F2F2EF' : /thermal|black|dark/i.test(w.option.name) ? '#3A3D40' : '#B9BDC1' }
  note('windows', w.option.name, w.image)

  let sanitary: InteriorFinishes['sanitary'], fittings: InteriorFinishes['fittings'], waterHeater: InteriorFinishes['waterHeater'], exhaust: InteriorFinishes['exhaust']
  if (wet) {
    const s = pick('sanitary')!
    sanitary = { name: s.option.name, image: s.photo, wc: /indian|orissa/i.test(s.option.name) ? 'indian' : /wall hung|premium/i.test(`${s.option.name} ${s.option.id}`) ? 'wall' : 'floor' }
    note('sanitary', s.option.name, s.photo)
    const f = pick('cp-fittings')!
    fittings = { name: f.option.name, image: f.photo, finish: /black|blk/i.test(f.option.name) ? 'black' : /gold|brass|gld/i.test(f.option.name) ? 'gold' : 'chrome' }
    note('cp-fittings', f.option.name, f.photo)
    if (assigned.has('water-heater')) {
      const h = pick('water-heater')!
      waterHeater = { name: h.option.name, image: h.photo, kind: /instant|3l|kwik/i.test(h.option.name) ? 'instant' : 'storage' }
      note('water-heater', h.option.name, h.photo)
    }
  }
  if (wet || kitchen) {
    const e = pick('electrical-exhaust', false)
    if (e) { exhaust = { name: e.option.name, image: e.photo }; note('electrical-exhaust', e.option.name, e.photo) }
  }
  let fan: InteriorFinishes['fan']
  if (HABITABLE.test(`${roomId} ${room.name}`) && !wet && !kitchen) {
    const f = pick('fans', false)!
    fan = { name: f.option.name, image: f.photo, style: /chandelier/i.test(f.option.name) ? 'chandelier' : /underlight/i.test(f.option.name) ? 'underlight' : 'plain' }
    note('fans', f.option.name, f.photo)
  }
  const l = pick('light-fittings', false)!
  const lights = { name: l.option.name, image: l.photo, kind: (/panel/i.test(l.option.name) ? 'panel' : /smart ceiling|moodflex|surface/i.test(l.option.name) ? 'surface' : 'downlight') as InteriorFinishes['lights']['kind'] }
  note('light-fittings', l.option.name, l.photo)
  let batten: InteriorFinishes['batten'], bulb: InteriorFinishes['bulb']
  if (kitchen || /utility|store|laundry/i.test(roomId)) {
    const b = pick('electrical-battens', false)
    if (b) { batten = { name: b.option.name, image: b.photo }; note('electrical-battens', b.option.name, b.photo) }
  }
  const bb = pick('electrical-bulbs', false)
  if (bb && !wet) { bulb = { name: bb.option.name, image: bb.photo }; note('electrical-bulbs', bb.option.name, bb.photo) }
  const sw = pick('switches', false)!
  const switches = { name: sw.option.name, image: sw.photo }
  note('switches', sw.option.name, sw.photo)

  return { walls: { color: paint.hex, paint: paint.label }, floor, wallTiles, ceiling, counter, cabinets, door, windowFrame,
    sanitary, fittings, waterHeater, exhaust, fan, lights, batten, bulb, switches, summary }
}
