import type { RoomModel } from '@/lib/three/buildRoom.ts'
import type { InteriorStyle } from './interiorStyles.ts'

/* Turn the real room (type, size, openings) + a style preset into an
 * SDXL prompt pair. The depth / edge maps hold the geometry; the prompt
 * only has to name the right room, the right furniture, the right number
 * of openings and the style — so the model dresses the actual room
 * rather than inventing an unrelated one. */

export type InteriorPrompt = {
  positive: string
  negative: string
  meta: { roomWord: string; furniture: string; openings: string }
}

function roomWord(model: RoomModel): string {
  const n = model.roomId.toLowerCase()
  if (n.includes('kitchen')) return 'kitchen'
  if (n.includes('bath')) return 'bathroom'
  if (n.includes('utility')) return 'utility room'
  if (n.includes('pooja')) return 'pooja (prayer) room'
  if (n.includes('dining')) return 'dining room'
  if (n.includes('living')) return 'living room'
  if (n.includes('study')) return 'study'
  if (n.includes('lounge')) return 'family lounge'
  if (n.includes('master')) return 'master bedroom'
  if (n.includes('bed')) return 'bedroom'
  if (n.includes('foyer')) return 'entrance foyer'
  if (n.includes('lobby')) return 'upstairs lobby'
  if (n.includes('stair')) return 'staircase hall'
  if (n.includes('hall')) return 'hall'
  return model.name.toLowerCase()
}

function furnitureFor(model: RoomModel): string {
  const n = model.roomId.toLowerCase()
  if (n.includes('kitchen'))
    return 'a fitted modular kitchen — base and wall cabinets, a stone countertop, an undermount sink below the window, a cooktop, a tall pantry unit, a slim breakfast counter'
  if (n.includes('bath'))
    return 'a wall-hung vanity with a framed mirror, a WC, a walk-in glass shower, recessed niches, a heated towel rail'
  if (n.includes('utility'))
    return 'a front-load washing machine, a deep utility sink, open steel shelving, a fold-down ironing board, a drying rack'
  if (n.includes('pooja'))
    return 'a carved teak mandir shrine on a low stone platform, hanging brass bells and oil lamps, a small seating mat, a shelf of framed deities'
  if (n.includes('dining'))
    return 'a six-seat solid-wood dining table with upholstered chairs, a sideboard against the wall, a linear pendant light centred over the table'
  if (n.includes('living'))
    return 'a three-seat sofa with an accent chair and pouffe, a coffee table, a low media console, a large area rug, a floor lamp, framed art and a few plants'
  if (n.includes('lounge'))
    return 'an L-shaped sectional sofa, a media wall unit, a bar cabinet, a lounge chair, layered floor and table lighting'
  if (n.includes('study'))
    return 'a desk with an ergonomic chair facing the window, a full-height bookshelf, a task lamp, a pinboard, a reading chair'
  if (n.includes('foyer'))
    return 'a slim console table with a mirror above it, a bench with shoe storage, wall hooks, a statement pendant light'
  if (n.includes('lobby') || n.includes('hall'))
    return 'a runner rug, a console or accent chair, wall art, a warm ceiling light'
  if (n.includes('stair'))
    return 'a staircase with a slatted timber or black-steel railing, a tall cascading pendant light, a bench below, minimal decor'
  if (n.includes('bed'))
    return 'a made double bed with an upholstered headboard and layered bedding, two bedside tables with lamps, a wardrobe along one wall, a bench at the foot of the bed, a soft rug'
  return 'tasteful, uncluttered furniture suited to the room, arranged against the walls'
}

function openingsPhrase(model: RoomModel): string {
  const wins = model.openings.filter((o) => o.kind === 'window')
  const doors = model.openings.filter((o) => o.kind !== 'window')
  const bits: string[] = []
  bits.push(wins.length === 0 ? 'no windows' : wins.length === 1 ? 'exactly one window' : `exactly ${wins.length} windows`)
  bits.push(doors.length === 0 ? 'no doorway' : doors.length === 1 ? 'one doorway' : `${doors.length} doorways`)
  const facing = wins.find((o) => o.viewRel === 'facing')
  const lead = facing
    ? 'The main window is on the wall directly ahead with daylight coming through it. '
    : wins.length
      ? 'Daylight enters from a side window. '
      : 'There is no exterior window — light the room warmly and evenly with lamps and ceiling light. '
  return `${lead}The room has ${bits.join(' and ')} — do not add, move or remove any windows or doors.`
}

export function buildInteriorPrompt(model: RoomModel, style: InteriorStyle): InteriorPrompt {
  const word = roomWord(model)
  const furniture = furnitureFor(model)
  const openings = openingsPhrase(model)
  const d = model.dims
  const size = `a ${d.w.toFixed(1)} by ${d.d.toFixed(1)} metre ${word} with a ${d.h.toFixed(1)} metre ceiling`

  const positive = [
    `Photorealistic interior photograph of ${size}, decorated in ${style.label} style.`,
    style.prompt,
    `Furnish it with ${furniture}.`,
    openings,
    'Keep the wall layout, ceiling height, opening positions and camera viewpoint exactly as the reference geometry.',
    'Wide-angle architectural interior photography, 24mm lens, eye level, natural daylight plus warm ambient light, physically based materials, realistic soft shadows and reflections, sharp focus, ultra-detailed, magazine quality, 8k.',
  ].join(' ')

  const negative = [
    'distorted perspective, warped or curved walls, sloping floor, extra windows, extra doors, blocked or missing openings, misaligned geometry, fisheye distortion',
    'blurry, low resolution, jpeg artifacts, noise, watermark, text, logo, signature, frame border',
    'people, faces, hands, pets',
    'clutter, messy, duplicated furniture, floating furniture, oversized furniture, mismatched scale',
    'cartoon, anime, illustration, painting, 3d render look, video game, plasticky, overexposed, oversaturated, HDR halo',
    style.negative ?? '',
  ]
    .filter(Boolean)
    .join(', ')

  return { positive, negative, meta: { roomWord: word, furniture, openings } }
}
