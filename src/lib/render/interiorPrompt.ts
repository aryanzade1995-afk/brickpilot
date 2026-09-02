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
    return 'a six-seat solid-wood dining table set with tableware and a runner, upholstered dining chairs, a full sideboard / crockery unit against the wall, a bar cart, a linear pendant light low over the table, framed art, a large rug under the table, curtains on the window, a potted plant in the corner'
  if (n.includes('living'))
    return 'a full three-seat sofa with two accent chairs and a pouffe, plenty of cushions and a throw, a coffee table with books and a tray, a large area rug, a media console with a wall-mounted TV, a tall bookshelf, side tables with table lamps, a floor lamp, full-length curtains on the window, framed art in a gallery arrangement, two or three large potted plants, a ceiling light'
  if (n.includes('lounge'))
    return 'a large L-shaped sectional sofa with cushions and throws, an ottoman, a media wall unit with a TV, a bar cabinet, two lounge chairs, a big rug, side tables and table lamps, a floor lamp, wall art, curtains, potted plants'
  if (n.includes('study'))
    return 'a desk with an ergonomic chair facing the window, a full-height bookshelf, a task lamp, a pinboard, a reading chair'
  if (n.includes('foyer'))
    return 'a slim console table with a mirror above it, a bench with shoe storage, wall hooks, a statement pendant light'
  if (n.includes('lobby') || n.includes('hall'))
    return 'a runner rug, a console or accent chair, wall art, a warm ceiling light'
  if (n.includes('stair'))
    return 'a staircase with a slatted timber or black-steel railing, a tall cascading pendant light, a bench below, minimal decor'
  if (n.includes('bed'))
    return 'a made king bed with an upholstered headboard, layered bedding, pillows and a throw, two bedside tables with lamps, a full-height wardrobe along one wall, a bench or blanket box at the foot of the bed, a dressing table with a mirror and stool, an armchair with a floor lamp in the corner, a large rug under the bed, full-length curtains on the window, wall art above the bed, a potted plant, a ceiling light'
  return 'a full, well-appointed set of furniture suited to the room — seating, storage, tables, lighting, a rug, curtains, wall art and plants'
}

function openingsPhrase(model: RoomModel): string {
  const wins = model.openings.filter((o) => o.kind === 'window')
  const doors = model.openings.filter((o) => o.kind !== 'window')
  const bits: string[] = []
  bits.push(wins.length === 0 ? 'no windows' : wins.length === 1 ? 'exactly one window' : `exactly ${wins.length} windows`)
  bits.push(doors.length === 0 ? 'no doorway' : doors.length === 1 ? 'one doorway' : `${doors.length} doorways`)
  const lead = wins.length
    ? 'Natural daylight comes through the window. '
    : 'There is no exterior window — light the room warmly and evenly with lamps and ceiling light. '
  return `${lead}The room has exactly ${bits.join(' and ')} — do not add, move or remove any windows or doors.`
}

export function buildInteriorPrompt(model: RoomModel, style: InteriorStyle): InteriorPrompt {
  const word = roomWord(model)
  const furniture = furnitureFor(model)
  const openings = openingsPhrase(model)
  const d = model.dims
  const size = `a ${d.w.toFixed(1)} by ${d.d.toFixed(1)} metre ${word} with a ${d.h.toFixed(1)} metre ceiling`

  const positive = [
    `Photorealistic interior photograph of a fully furnished, richly decorated, lived-in ${size}, ${style.label} style.`,
    `The room is completely furnished with ${furniture} — every piece present, well arranged and clearly in shot, the room looks warm and inhabited, not staged empty.`,
    style.prompt,
    openings,
    'Keep the wall layout, ceiling height, opening positions and camera viewpoint exactly as the reference geometry.',
    'Interior design magazine photograph, 28mm lens, eye level, natural daylight plus warm layered lighting, physically based materials, realistic soft shadows and reflections, styled and dressed, sharp focus, ultra-detailed, 8k.',
  ].join(' ')

  const negative = [
    'empty room, bare room, unfurnished, undecorated, sparse, vacant, staged empty, minimal furniture, empty floor, bare walls, nothing on the walls, nothing in the room, showroom',
    'distorted perspective, warped or curved walls, sloping floor, extra windows, extra doors, blocked or missing openings, misaligned geometry, fisheye distortion',
    'blurry, low resolution, jpeg artifacts, noise, watermark, text, logo, signature, frame border',
    'people, faces, hands, pets',
    'duplicated furniture, floating furniture, oversized furniture, mismatched scale, messy pile',
    'cartoon, anime, illustration, painting, 3d render look, video game, plasticky, overexposed, oversaturated, HDR halo',
    style.negative ?? '',
  ]
    .filter(Boolean)
    .join(', ')

  return { positive, negative, meta: { roomWord: word, furniture, openings } }
}
