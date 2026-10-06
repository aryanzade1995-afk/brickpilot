import type { Design } from '../engine/types.ts'
import type { Brief } from '../model/brief.ts'
import { createFinishAssignments } from '../cost/finishAssignments.ts'
import { resolveSpecification, specsCatalogue } from '../cost/catalogue.ts'
import { paintColour } from '../finishes/paint.ts'
import { optionImage, representativeOption } from '../finishes/optionImage.ts'
import { toneOf } from '../render/roomSpecs.ts'
import { finishProduct, type FinishProduct } from '../finishes/catalogue.ts'

/* ------------------------------------------------------------------ *
 *  What the person chose on Finishes & Cost, resolved for ONE room, in the
 *  form the 360 renderer draws: real product textures where the catalogue
 *  has a surface photo, the product's photo for fixtures (its colour is read
 *  from it), and the plan's own rules for where each item is fitted.
 *  Nothing is invented: every value comes from the Brief's specification
 *  overrides, or the finish level's preset where the person left an item alone.
 * ------------------------------------------------------------------ */

type Pattern = 'image' | 'tile' | 'plank' | 'subway' | 'mosaic' | 'large'
type Fixture = { name: string; image?: string; profile?: FinishProduct['preview'] }
export type Surface = { name: string; color: string; image?: string; tileM: number; pattern: Pattern; rough: number }
export type InteriorFinishes = {
  walls: { color: string; paint: string; system: string; rough: number; metallic: boolean; textured: boolean }
  floor: Surface
  wallTiles?: Surface & { zone: 'full' | 'backsplash'; heightM: number }
  ceiling: { type: 'plain' | 'false' | 'cove' | 'tray' | 'wooden'; color: string; name: string; pattern: string }
  counter?: Surface
  cabinets?: { name: string; color: string; image?: string; gloss: boolean; glass: boolean }
  kitchenSink?: { name: string; bowls: 1 | 2; finish: 'steel' | 'black' | 'white'; image?: string }
  kitchenHardware?: { name: string; handleless: boolean; drawers: boolean }
  door: { name: string; color: string; image?: string; glass: boolean }
  mainDoor: InteriorFinishes['door']
  doorHardware: { name: string; digital: boolean }
  windowFrame: { name: string; color: string; style: 'fixed' | 'sliding' | 'casement'; slim: boolean }
  glazing: { name: string; frosted: boolean; solar: boolean; double: boolean }
  grills: { name: string; mesh: boolean; bars: boolean; decorative: boolean; stainless: boolean }
  sanitary?: { name: string; wc: 'floor' | 'wall' | 'indian'; image?: string }
  fittings?: { name: string; finish: 'chrome' | 'black' | 'gold'; image?: string }
  basin?: Fixture
  shower?: Fixture
  tub?: Fixture
  enclosure?: Fixture
  waterHeater?: Fixture & { kind: 'storage' | 'instant' }
  exhaust?: Fixture
  fan?: Fixture & { style: 'plain' | 'chandelier' | 'underlight' }
  lights: Fixture & { kind: 'downlight' | 'panel' | 'surface' }
  batten?: Fixture
  bulb?: Fixture
  switches: Fixture
  /** Exact option IDs, including concealed systems: never identify products by display name alone. */
  specifications: { item: string; optionId: string; productId?: string; name: string }[]
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
  if (!room || !brief) return null
  const overrides = brief.specs?.overrides ?? {}
  const roomKey = `${floorLevel}:${room.semanticId ?? roomId}`
  const semantic = room.semanticId ?? roomId
  const assigned = new Set((createFinishAssignments(design, brief).rooms.find((r) => r.id === roomKey)?.finishes ?? []).map((f) => f.item))
  const label = (item: string) => specsCatalogue.items.find((i) => i.id === item)?.label ?? item
  const pick = (item: string, perRoom = true) => {
    if (!specsCatalogue.items.some((i) => i.id === item)) return null
    const chosen = perRoom ? resolveSpecification(brief, item, overrides[`${item}@${roomKey}`] === undefined ? semantic : roomKey) : resolveSpecification(brief, item)
    // a general allowance (Standard / Enhanced / Premium) is dressed as the same pictured product its Finishes card shows
    const shown = /^(basic|mid|premium)$/.test(chosen.id) ? representativeOption(specsCatalogue.items.find((i) => i.id === item)!, chosen) : chosen
    const option = shown.id === chosen.id ? chosen : { ...shown, name: `${chosen.name} · ${shown.name}` }
    const image = optionImage(option)
    // a fixture's picture is only its product photo, never a stand-in material texture
    return { option, chosen, image: image?.src, surface: !!image?.surface, photo: image && !image.surface ? image.src : undefined, profile: finishProduct(option.finishProductId)?.preview }
  }
  const summary: InteriorFinishes['summary'] = []
  const note = (item: string, value: string, image?: string) => summary.push({ label: label(item), value, image })
  const roomType = `${roomId} ${room.semanticId ?? ''} ${room.name}`
  const wet = /bath|toilet|wc|powder/i.test(roomType), kitchen = /kitchen/i.test(roomType)

  const paint = paintColour({ ...brief, specs: { overrides } }, roomKey), paintSystem = pick('interior-paint')!
  note('interior-paint', `${paintSystem.option.name} · ${paint.label}`)

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
  const ceiling = { type: ceilingType, color: '#F6F4F0', name: c.option.name, pattern: c.option.id }
  note('false-ceiling', c.option.name)

  let counter: InteriorFinishes['counter'], cabinets: InteriorFinishes['cabinets']
  let kitchenSink: InteriorFinishes['kitchenSink'], kitchenHardware: InteriorFinishes['kitchenHardware']
  if (kitchen) {
    const k = pick('kitchen-counter', false)!
    counter = surfaceOf(k.option.name, k.surface ? k.image : undefined, 'counter')
    note('kitchen-counter', k.option.name, k.image)
    const cb = pick('kitchen-cabinets', false)!
    const name = cb.option.name
    cabinets = { name, image: cb.surface ? cb.image : undefined, gloss: /acrylic|pu|gloss|membrane/i.test(name), glass: /glass/i.test(name),
      color: /acrylic|pu-painted|pu |membrane/i.test(name) ? '#F1EFEA' : /matt/i.test(name) ? '#5E6467' : /laminate|handleless/i.test(name) ? '#D9D5CE' : toneOf(name).hex }
    note('kitchen-cabinets', name, cb.image)
    const sink = pick('kitchen-sink', false)!
    const sinkName = `${sink.option.id} ${sink.option.name}`
    kitchenSink = { name: sink.option.name, bowls: /double|premium|quartz|granite/i.test(sinkName) ? 2 : 1,
      finish: /black|granite|quartz/i.test(sinkName) ? 'black' : /white|ceramic/i.test(sinkName) ? 'white' : 'steel', image: sink.photo }
    note('kitchen-sink', sink.option.name, sink.photo)
    const hardware = pick('kitchen-hardware', false)!
    kitchenHardware = { name: hardware.option.name, handleless: /handleless/i.test(name), drawers: /drawer|hettich|blum/i.test(`${hardware.option.id} ${hardware.option.name}`) }
    note('kitchen-hardware', hardware.option.name, hardware.photo)
  }

  const d = pick('internal-door', false)!
  const door = { name: d.option.name, image: d.surface ? d.image : undefined, glass: /glass/i.test(d.option.name),
    color: /paint|pvc|upvc|white/i.test(d.option.name) ? '#EEEBE4' : /dark|walnut|flush doors/i.test(d.option.name) ? '#5A3B2A' : toneOf(d.option.name).hex }
  note('internal-door', d.option.name, d.image)
  const md = pick('main-door', false)!
  const mainDoor = { name: md.option.name, image: md.surface ? md.image : undefined, glass: /glass/i.test(md.option.name), color: toneOf(md.option.name).hex }
  const dh = pick('door-hardware', false)!
  const doorHardware = { name: dh.option.name, digital: /digital/i.test(dh.option.name) }
  note('door-hardware', dh.option.name, dh.image)
  const w = pick('windows', false)!
  const windowFrame = { name: w.option.name, color: /upvc/i.test(w.option.name) ? '#F2F2EF' : /thermal|black|dark/i.test(w.option.name) ? '#3A3D40' : '#B9BDC1',
    style: (/fixed/i.test(w.option.name) ? 'fixed' : /slid/i.test(w.option.name) ? 'sliding' : 'casement') as InteriorFinishes['windowFrame']['style'], slim: /slim/i.test(w.option.name) }
  note('windows', w.option.name, w.image)
  const g = pick('glass', false)!, gr = pick('window-grills', false)!
  const glazing = { name: g.option.name, frosted: /frost/i.test(g.option.name), solar: /solar/i.test(g.option.name), double: /double|dgu/i.test(g.option.name) }
  const grills = { name: gr.option.name, mesh: /mesh|mosquito/i.test(gr.option.name), bars: !/mesh screen/i.test(gr.option.name), decorative: /decorative|laser/i.test(gr.option.name), stainless: /stainless/i.test(gr.option.name) }
  note('glass', g.option.name, g.image); note('window-grills', gr.option.name, gr.image)

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
  const fixture = (item: string, optional = false): Fixture | undefined => {
    if (optional && overrides[item] === undefined && overrides[`${item}@${roomKey}`] === undefined && overrides[`${item}@${semantic}`] === undefined) return undefined
    const value = pick(item)!
    note(item, value.option.name, value.photo)
    return { name: value.option.name, image: value.photo, profile: value.profile }
  }
  const basin = wet ? fixture('bath-basin') : undefined, shower = wet ? fixture('bath-shower') : undefined
  // These are optional installation preferences, not automatically included by a finish preset.
  const tub = wet ? fixture('bath-tub', true) : undefined, enclosure = wet ? fixture('bath-enclosure', true) : undefined
  if (waterHeater) waterHeater.profile = pick('water-heater')!.profile
  if (wet || kitchen) {
    const e = pick('electrical-exhaust', false)
    if (e) { exhaust = { name: e.option.name, image: e.photo, profile: e.profile }; note('electrical-exhaust', e.option.name, e.photo) }
  }
  let fan: InteriorFinishes['fan']
  if (HABITABLE.test(`${roomId} ${room.name}`) && !wet && !kitchen) {
    const f = pick('fans', false)!
    fan = { name: f.option.name, image: f.photo, profile: f.profile, style: /chandelier/i.test(f.option.name) ? 'chandelier' : /underlight/i.test(f.option.name) ? 'underlight' : 'plain' }
    note('fans', f.option.name, f.photo)
  }
  const l = pick('light-fittings', false)!
  const lights = { name: l.option.name, image: l.photo, profile: l.profile, kind: (/panel/i.test(l.option.name) ? 'panel' : /smart ceiling|moodflex|surface/i.test(l.option.name) ? 'surface' : 'downlight') as InteriorFinishes['lights']['kind'] }
  note('light-fittings', l.option.name, l.photo)
  let batten: InteriorFinishes['batten'], bulb: InteriorFinishes['bulb']
  if (kitchen || /utility|store|laundry/i.test(roomId)) {
    const b = pick('electrical-battens', false)
    if (b) { batten = { name: b.option.name, image: b.photo, profile: b.profile }; note('electrical-battens', b.option.name, b.photo) }
  }
  const bb = pick('electrical-bulbs', false)
  if (bb && !wet) { bulb = { name: bb.option.name, image: bb.photo, profile: bb.profile }; note('electrical-bulbs', bb.option.name, bb.photo) }
  const sw = pick('switches', false)!
  const switches = { name: sw.option.name, image: sw.photo, profile: sw.profile }
  note('switches', sw.option.name, sw.photo)

  const specifications = specsCatalogue.items.filter(i => i.level !== 'auto' && (i.scope === 'house' || assigned.has(i.id) ||
    wet && ['bath-basin', 'bath-shower', 'bath-tub', 'bath-enclosure'].includes(i.id))).map(i => {
    const { option, chosen } = pick(i.id)!
    return { item: i.id, optionId: chosen.id, productId: option.finishProductId, name: option.name }
  })
  return { walls: { color: paint.hex, paint: paint.label, system: paintSystem.option.name, rough: /satin|metallic/i.test(paintSystem.option.name) ? .28 : /eggshell|aspira/i.test(paintSystem.option.name) ? .45 : .78,
    metallic: /metallic/i.test(paintSystem.option.name), textured: /textur|stone-effect/i.test(paintSystem.option.name) }, floor, wallTiles, ceiling, counter, cabinets, kitchenSink, kitchenHardware, door, mainDoor, doorHardware, windowFrame, glazing, grills,
    sanitary, fittings, basin, shower, tub, enclosure, waterHeater, exhaust, fan, lights, batten, bulb, switches, specifications, summary }
}
