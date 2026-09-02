/* Interior style presets — each supplies a materials / palette / light /
 * decor fragment that the prompt builder folds around the room's real
 * geometry. `id` is stable (used in state + downloads). */

export type InteriorStyle = {
  id: string
  label: string
  /** one-line note for the picker */
  note: string
  /** positive fragment: materials, palette, mood, light */
  prompt: string
  /** extra negative terms specific to this style */
  negative?: string
}

export const INTERIOR_STYLES: InteriorStyle[] = [
  {
    id: 'modern-indian',
    label: 'Modern Indian',
    note: 'Warm contemporary — teak, brass, handloom',
    prompt:
      'Contemporary Indian interior: honey-toned teak joinery, off-white textured plaster walls, a polished grey vitrified or Kota-stone floor, brass and matte-black accents, handloom cotton and ikat textiles, a few brass planters and terracotta pieces, warm 3000K lighting with a linear cove.',
  },
  {
    id: 'kerala',
    label: 'Kerala traditional',
    note: 'Nalukettu warmth — rosewood, terracotta, laterite',
    prompt:
      'Traditional Kerala interior: dark polished rosewood columns, beams and furniture, red-oxide or terracotta-tile flooring, white lime-plaster walls, a sloping timber-lined ceiling, antique brass lamps (nilavilakku), cane and jackwood pieces, filtered tropical daylight through timber-louvred openings.',
  },
  {
    id: 'rajasthani',
    label: 'Rajasthani',
    note: 'Haveli colour — carved wood, jharokha, mirror-work',
    prompt:
      'Rajasthani haveli interior: intricately carved wooden furniture and jharokha niches, lime-plaster walls in soft ochre and indigo with fresco borders, marble or sandstone floor with a bandhani-pattern dhurrie, mirror-work and inlay accents, brass urlis and lanterns, jewel-tone silk cushions, warm lamp light.',
  },
  {
    id: 'chettinad',
    label: 'Chettinad',
    note: 'Athangudi tiles, teak, high airy ceilings',
    prompt:
      'Chettinad mansion interior: glossy hand-made Athangudi patterned floor tiles, egg-plaster walls with a satin sheen, teak and Burma-teak pillars and heavy carved furniture, tall shuttered windows, brass and ceramic curios, antique wall clocks and portraits, cool even daylight.',
  },
  {
    id: 'luxury',
    label: 'Luxury contemporary',
    note: 'Marble, walnut, statement lighting',
    prompt:
      'Luxury contemporary interior: book-matched marble feature walls, dark walnut and fluted-oak veneer, brushed-brass inlays, a large-format stone or engineered-timber floor, a designer chandelier or sculptural pendant, velvet and boucle upholstery, concealed warm lighting, curated art, a restrained neutral palette with one deep accent.',
  },
  {
    id: 'minimalist',
    label: 'Minimalist',
    note: 'Micro-cement, oak, quiet and bright',
    prompt:
      'Minimalist interior: seamless micro-cement or lime-washed walls in warm white, pale oak floor and joinery, hidden storage, one or two low-profile pieces of furniture, no visible clutter, a single ceramic or plant as accent, soft diffuse daylight, calm and airy.',
  },
  {
    id: 'scandinavian',
    label: 'Scandinavian',
    note: 'Light wood, white, cosy textiles',
    prompt:
      'Scandinavian interior: white walls, light ash or birch floor and furniture, tapered wooden legs, wool and linen textiles in muted tones, a chunky knit throw, paper pendant lamp, a few books and a plant, bright soft northern daylight, hygge warmth.',
  },
  {
    id: 'industrial',
    label: 'Industrial',
    note: 'Exposed concrete, black steel, Edison light',
    prompt:
      'Industrial interior: exposed board-formed concrete and one brick wall, black powder-coated steel framing and shelving, reclaimed-wood surfaces, polished concrete floor, filament pendant lights on black cord, leather and canvas furniture, utilitarian and raw but comfortable.',
    negative: 'floral, ornate carving, pastel',
  },
]

export const styleById = (id: string): InteriorStyle => INTERIOR_STYLES.find((s) => s.id === id) ?? INTERIOR_STYLES[0]
