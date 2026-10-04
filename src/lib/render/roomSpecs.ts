import type { Design } from '../engine/types.ts'
import type { Brief } from '../model/brief.ts'
import { createFinishAssignments } from '../cost/finishAssignments.ts'
import { resolveSpecification, specsCatalogue } from '../cost/catalogue.ts'
import { paintColour } from '../finishes/paint.ts'

/* The finishes the user chose on the Finishes & Cost page, resolved for ONE room: what the 3D room is
 * coloured with and what the AI prompt must state. Nothing here is invented — every line comes from the
 * Brief's specification overrides (or the finish level's preset when the user left an item alone). */

export type SpecLine = { item: string; label: string; value: string; hex?: string }
export type RoomSpecs = {
  lines: SpecLine[]
  /** colours the 3D room is drawn with */
  look: { wall: string; slab: string; ceil: string; trim: string }
  /** the wording the AI prompt must follow */
  statement: string
  negative: string
}

/** a descriptive colour/material tone for a chosen option; used for the 3D shell and the prompt */
const TONES: [RegExp, string, string][] = [
  [/statuario|calacatta|onyx|white marble|marble-look|marble-gvt|large-format marble/i, '#ECE9E3', 'white marble with grey veining'],
  [/italian marble|indian marble|marble/i, '#E4DCCB', 'polished cream marble'],
  [/walnut|dark wood/i, '#5A3B2A', 'dark walnut wood'],
  [/teak|wood/i, '#B07C48', 'warm teak wood'],
  [/kota/i, '#6E7469', 'grey-green Kota stone'],
  [/granite/i, '#4C4C4E', 'dark polished granite'],
  [/slate/i, '#4C5258', 'dark slate'],
  [/concrete/i, '#8F9091', 'grey micro-concrete'],
  [/terrazzo|mosaic/i, '#CFC8BD', 'speckled terrazzo'],
  [/travertine/i, '#D9C8A5', 'beige travertine'],
  [/sandstone|stone/i, '#C8AA7C', 'sand-coloured natural stone'],
  [/moroccan|encaustic|decorative|patterned/i, '#B9906B', 'patterned encaustic tile'],
  [/terracotta|brick/i, '#B2593B', 'terracotta'],
  [/subway|glass/i, '#E7ECEE', 'glossy white tile'],
  [/ceramic|vitrified|porcelain|tile|gvt/i, '#D8D4CB', 'light grey-beige vitrified tile'],
]
export function toneOf(name: string): { hex: string; word: string } {
  const hit = TONES.find(([re]) => re.test(name))
  return hit ? { hex: hit[1], word: hit[2] } : { hex: '#D8D4CB', word: name.toLowerCase() }
}

/** a plain colour word for a hex: SDXL understands "warm light grey", not "#C9C3B8" */
export function colourWord(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60
  const tone = l > .9 ? 'very light' : l > .74 ? 'light' : l > .5 ? 'mid' : l > .3 ? 'deep' : 'dark'
  if (sat < .08) return l > .93 ? 'pure white' : l > .8 ? 'off-white' : l > .55 ? `${tone} grey` : `${tone} charcoal`
  const name = h < 15 || h >= 345 ? 'red' : h < 40 ? 'orange' : h < 65 ? 'yellow' : h < 160 ? 'green' : h < 200 ? 'teal' : h < 255 ? 'blue' : h < 290 ? 'purple' : 'pink'
  const warm = h < 65 && sat < .35 ? (l > .74 ? 'cream / beige' : 'tan') : name
  return `${tone} ${warm}`
}

const roomOption = (brief: Brief, item: string, roomKey: string) => {
  const catalogueItem = specsCatalogue.items.find(i => i.id === item)
  if (!catalogueItem) return null
  const semantic = roomKey.slice(roomKey.indexOf(':') + 1)
  const option = resolveSpecification(brief, item, brief.specs.overrides[`${item}@${roomKey}`] === undefined ? semantic : roomKey)
  return { label: catalogueItem.label, option }
}
const houseOption = (brief: Brief, item: string) => {
  const catalogueItem = specsCatalogue.items.find(i => i.id === item)
  return catalogueItem ? { label: catalogueItem.label, option: resolveSpecification(brief, item) } : null
}

export function roomSpecs(design: Design, brief: Brief, floorLevel: number, roomId: string): RoomSpecs {
  // cost and finish keys use the plan's semantic id (GF_LIVING), the 3D room list uses the short id (living)
  const room = design.floors.find(f => f.level === floorLevel)?.rooms.find(r => r.id === roomId)
  const roomKey = `${floorLevel}:${room?.semanticId ?? roomId}`
  const lines: SpecLine[] = []
  const paint = paintColour(brief, roomKey)
  const assigned = createFinishAssignments(design, brief).rooms.find(r => r.id === roomKey)?.finishes ?? []
  const byItem = new Map(assigned.map(f => [f.item, f]))
  const get = (item: string) => byItem.has(item) ? roomOption(brief, item, roomKey) : null
  const wet = /bath|toilet|wc/i.test(roomId), kitchen = /kitchen/i.test(roomId)

  const paintSystem = get('interior-paint')
  lines.push({ item: 'interior-paint', label: 'Wall paint', value: `${paint.label}${paintSystem ? ` — ${paintSystem.option.name}` : ''}`, hex: paint.hex })

  const floorItem = ['floor-living', 'floor-bedrooms', 'floor-kitchen', 'floor-bathrooms', 'floor-other'].find(i => byItem.has(i))
  const floor = floorItem ? get(floorItem) : null
  const floorTone = floor ? toneOf(floor.option.name) : toneOf('vitrified')
  if (floor) lines.push({ item: floorItem!, label: 'Flooring', value: floor.option.name, hex: floorTone.hex })

  const ceiling = get('false-ceiling')
  const ceilingNone = !ceiling || ceiling.option.id === 'none'
  const ceilingTone = ceilingNone ? { hex: '#F4F2EE', word: 'plain white plastered ceiling' }
    : /slat|timber/i.test(ceiling!.option.name) ? { hex: '#B07C48', word: 'timber slat ceiling' }
      : { hex: '#F6F4F0', word: ceiling!.option.name.toLowerCase() }
  lines.push({ item: 'false-ceiling', label: 'Ceiling', value: ceilingNone ? 'Plain plastered ceiling' : ceiling!.option.name, hex: ceilingTone.hex })

  let wallTiles: { name: string; tone: { hex: string; word: string } } | null = null
  const tileItem = wet ? 'bath-wall-tiles' : kitchen ? 'kitchen-wall-tiles' : null
  const tiles = tileItem ? get(tileItem) : null
  if (tiles && tileItem) {
    wallTiles = { name: tiles.option.name, tone: toneOf(tiles.option.name) }
    lines.push({ item: tileItem, label: wet ? 'Wall tiles' : 'Kitchen backsplash', value: tiles.option.name, hex: wallTiles.tone.hex })
  }
  if (kitchen) {
    const counter = houseOption(brief, 'kitchen-counter'), cabinets = houseOption(brief, 'kitchen-cabinets')
    if (counter) lines.push({ item: 'kitchen-counter', label: 'Countertop', value: counter.option.name, hex: toneOf(counter.option.name).hex })
    if (cabinets) lines.push({ item: 'kitchen-cabinets', label: 'Cabinets', value: cabinets.option.name })
  }
  if (wet) {
    const sanitary = get('sanitary'), fittings = get('cp-fittings')
    if (sanitary) lines.push({ item: 'sanitary', label: 'Sanitary ware', value: sanitary.option.name })
    if (fittings) lines.push({ item: 'cp-fittings', label: 'Taps & shower', value: fittings.option.name })
  }
  const door = houseOption(brief, 'internal-door'), windows = houseOption(brief, 'windows'), lights = houseOption(brief, 'light-fittings')
  const doorTone = door ? toneOf(door.option.name) : toneOf('wood')
  if (door) lines.push({ item: 'internal-door', label: 'Internal doors', value: door.option.name, hex: doorTone.hex })
  if (windows) lines.push({ item: 'windows', label: 'Windows', value: windows.option.name })
  if (lights) lines.push({ item: 'light-fittings', label: 'Light fittings', value: lights.option.name })

  const paintWord = colourWord(paint.hex)
  const detail = (items: string[]) => lines.filter(l => items.includes(l.item)).map(l => `${l.label.toLowerCase()} ${l.value}`).join(', ')
  const parts = [
    `walls painted ${paintWord} (${paint.label.split(' · ')[0]})`,
    floor ? `floor of ${floor.option.name} (${floorTone.word})` : '',
    `ceiling: ${ceilingNone ? 'plain white plaster' : ceiling!.option.name}`,
    wallTiles ? `${wet ? 'wall tiles' : 'backsplash'} of ${wallTiles.name} (${wallTiles.tone.word})` : '',
    kitchen ? detail(['kitchen-counter', 'kitchen-cabinets']) : '',
    wet ? detail(['sanitary', 'cp-fittings']) : '',
    door ? `doors: ${door.option.name}` : '',
    windows ? `window frames: ${windows.option.name}` : '',
  ].filter(Boolean)
  const statement = `STRICT SPECIFICATION, use exactly this for the surfaces and nothing else: ${parts.join('; ')}. Furniture and decor must not change these colours or materials.`
  const negative = `walls in any colour other than ${paintWord}, a different floor material or floor colour, a different ceiling, patterned or wallpapered walls, contrasting accent wall`
  return {
    lines, statement, negative,
    look: { wall: wallTiles && wet ? wallTiles.tone.hex : paint.hex, slab: floorTone.hex, ceil: ceilingTone.hex, trim: door ? doorTone.hex : '#f3efe6' },
  }
}
