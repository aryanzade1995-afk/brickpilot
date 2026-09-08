/* ------------------------------------------------------------------ *
 *  StyleGrammar catalogue — the architectural rules per style.
 *
 *  Each style declares *real* architectural characteristics: which
 *  plan footprints and volumetric strategies it allows, its roof
 *  language, how it glazes each room type, its entrance, balconies,
 *  facade vocabulary (fins / jaali / cladding / feature pier / string
 *  course / chajja / verandah / pergola / tower) and materials.
 *
 *  The grammar is pure data + no geometry. `generateDesign()` resolves
 *  it against a floor plan + a seed into a concrete DesignSpec, which
 *  the Blender generator turns into a GLB.
 *
 *  Calibrated against real South-Asian villas — see each style's
 *  `refs`. The UI `character` maps 1:1 to a StyleId.
 * ------------------------------------------------------------------ */

import type { Character } from '../lib/model/brief.ts'
import type { RoomClass, RoomWindowRule, StyleGrammar, StyleId } from './types.ts'

/* ---- UI character  <->  grammar style ---------------------------- */

export const STYLE_OF_CHARACTER: Record<Character, StyleId> = {
  'modern-indian': 'modern_indian',
  'contemporary-indian': 'contemporary_indian',
}

export const CHARACTER_OF_STYLE: Record<StyleId, Character> = Object.fromEntries(
  Object.entries(STYLE_OF_CHARACTER).map(([c, s]) => [s, c]),
) as Record<StyleId, Character>

/* ---- reusable per-room window rules ----------------------------- */

const W = (r: RoomWindowRule): RoomWindowRule => r

const ROOM_W = {
  livingLarge: W({
    preferred: 2,
    max: 3,
    widthMm: [1800, 3600],
    heightMm: [1800, 2600],
    sillMm: 450,
    privacy: false,
    allowStrip: true,
    allowPicture: true,
  }),
  livingModerate: W({
    preferred: 2,
    max: 2,
    widthMm: [1500, 2600],
    heightMm: [1500, 2200],
    sillMm: 600,
    privacy: false,
    allowStrip: true,
    allowPicture: false,
  }),
  diningMod: W({
    preferred: 1,
    max: 2,
    widthMm: [1400, 2400],
    heightMm: [1400, 2100],
    sillMm: 700,
    privacy: false,
    allowStrip: true,
    allowPicture: false,
  }),
  kitchen: W({
    preferred: 1,
    max: 1,
    widthMm: [1000, 1600],
    heightMm: [1000, 1400],
    sillMm: 1050,
    privacy: false,
    allowStrip: false,
    allowPicture: false,
  }),
  bedroom: W({
    preferred: 1,
    max: 2,
    widthMm: [1200, 2100],
    heightMm: [1350, 1800],
    sillMm: 750,
    privacy: false,
    allowStrip: false,
    allowPicture: false,
  }),
  bedroomGenerous: W({
    preferred: 2,
    max: 2,
    widthMm: [1400, 2400],
    heightMm: [1500, 2100],
    sillMm: 600,
    privacy: false,
    allowStrip: false,
    allowPicture: true,
  }),
  master: W({
    preferred: 2,
    max: 2,
    widthMm: [1500, 2600],
    heightMm: [1500, 2200],
    sillMm: 600,
    privacy: false,
    allowStrip: false,
    allowPicture: true,
  }),
  bath: W({
    preferred: 1,
    max: 1,
    widthMm: [500, 800],
    heightMm: [500, 900],
    sillMm: 1500,
    privacy: true,
    allowStrip: false,
    allowPicture: false,
  }),
  study: W({
    preferred: 1,
    max: 2,
    widthMm: [1200, 2000],
    heightMm: [1300, 1900],
    sillMm: 750,
    privacy: false,
    allowStrip: false,
    allowPicture: false,
  }),
  stair: W({
    preferred: 0,
    max: 1,
    widthMm: [700, 1400],
    heightMm: [1800, 3000],
    sillMm: 900,
    privacy: false,
    allowStrip: false,
    allowPicture: false,
  }),
  utility: W({
    preferred: 1,
    max: 1,
    widthMm: [600, 1000],
    heightMm: [700, 1100],
    sillMm: 1200,
    privacy: true,
    allowStrip: false,
    allowPicture: false,
  }),
  poojaSlot: W({
    preferred: 0,
    max: 1,
    widthMm: [400, 700],
    heightMm: [900, 1500],
    sillMm: 900,
    privacy: false,
    allowStrip: false,
    allowPicture: false,
  }),
} as const

const COMMON_BY_ROOM: Partial<Record<RoomClass, RoomWindowRule>> = {
  kitchen: ROOM_W.kitchen,
  bathroom: ROOM_W.bath,
  utility: ROOM_W.utility,
  study: ROOM_W.study,
  stair: ROOM_W.stair,
  pooja: ROOM_W.poojaSlot,
}

/* ================================================================== *
 *  THE 8 STYLES
 * ================================================================== */

export const STYLE_GRAMMARS: Record<StyleId, StyleGrammar> = {
  /* -------------------------------------------------------------- */
  modern_indian: {
    id: 'modern_indian',
    label: 'Modern Indian',
    summary:
      'Stacked and offset white plaster volumes, thin floating slabs, a cantilevered upper floor, vertical shading fins, a jaali-clad stair tower, stone feature walls and controlled glazing.',
    refs: ['Ahmedabad / Hyderabad contemporary villas — offset white boxes, deep cantilevers, vertical fins, riven-stone piers'],
    massing: {
      planShapes: ['rectangular', 'l_shape', 'square', 't_shape'],
      strategies: [
        { kind: 'offset_volumes', weight: 4 },
        { kind: 'cantilever', weight: 3 },
        { kind: 'stacked', weight: 2 },
        { kind: 'split_mass', weight: 2 },
        { kind: 'stepped', weight: 1 },
      ],
      storeyOffsetMm: [900, 2200],
      cantileverMm: [800, 1500],
      splitGapMm: [1800, 3000],
      groundExtendMm: 2200,
      featureTowerChance: 0.55,
      maxAspect: 1.9,
    },
    roof: {
      kind: 'flat_band',
      pitchDeg: [0, 0],
      eaveMm: [600, 820],
      parapetMm: 0,
      bandMm: 210,
      perBlock: true,
      terraceChance: 0.6,
    },
    window: {
      byRoom: { ...COMMON_BY_ROOM, living: ROOM_W.livingLarge, dining: ROOM_W.diningMod, bedroom: ROOM_W.bedroom, master: ROOM_W.master },
      fallback: ROOM_W.bedroom,
      maxWindowRatio: 0.38,
      minWallBetweenWindowsMm: 700,
      minCornerOffsetMm: 500,
      minDoorWindowDistanceMm: 450,
      stripGlazingChance: 0.4,
      pictureWindowChance: 0.3,
      upperPrivacyBias: 0.35,
    },
    door: { entryWidthMm: [1500, 1800], internalWidthMm: 900, doubleLeafEntry: true, entryCanopyMm: 900, doubleHeightEntry: false, porteCochere: false },
    balcony: { rooms: ['master', 'bedroom', 'living'], depthMm: [1400, 1900], minWidthMm: 1800, maxPerFloor: 2, recessedChance: 0.5, railStyle: 'glass', wrapVerandah: false },
    facade: {
      verticalFinsChance: 0.7,
      finDepthMm: [250, 380],
      jaaliScreenChance: 0.5,
      jaaliWhere: ['entry', 'stair'],
      cladPanels: { material: 'teak', widthMm: [1400, 1900], twoStorey: false },
      featurePier: { material: 'stone_dark', chance: 0.6 },
      stringCourseMm: 60,
      chajjaMm: 0,
      plinthMm: 150,
      baseCladding: 'stone_dark',
      pergola: ['roof'],
      verandah: null,
    },
    material: {
      palette: 'white',
      wall: '#ece7db',
      base: '#33322f',
      trim: '#f6f4ee',
      roof: '#f6f4ee',
      frame: '#24242a',
      accent: '#96683c',
      glassTint: '#2f3e48',
      variants: { wall: ['#efe9dd', '#e8e2d4'], accent: ['#8a5c34', '#7a5230'] },
      seededSwaps: 2,
    },
    constraints: { window: { maxWindowRatio: 0.38, minWallBetweenWindowsMm: 700, minCornerOffsetMm: 500, minDoorWindowDistanceMm: 450, maxWindowsPerRoom: 3, preferredWindowsPerRoom: 1 } },
  },

  /* -------------------------------------------------------------- */
  contemporary_indian: {
    id: 'contemporary_indian',
    label: 'Contemporary Indian',
    summary:
      'Off-white plaster planes over a dark stone-clad ground floor, wide aluminium sliders under deep flat hoods, a floating roof, a timber screen to the stair and a recessed double-height entrance.',
    refs: ['Pune / Bengaluru farmhouse villas — plaster over basalt base, deep chajja hoods, double-height glazed entry'],
    massing: {
      planShapes: ['rectangular', 'l_shape', 'square', 't_shape'],
      strategies: [
        { kind: 'stacked', weight: 4 },
        { kind: 'cantilever', weight: 3 },
        { kind: 'offset_volumes', weight: 2 },
        { kind: 'split_mass', weight: 1 },
      ],
      storeyOffsetMm: [600, 1400],
      cantileverMm: [900, 1600],
      splitGapMm: [2000, 3200],
      groundExtendMm: 2400,
      featureTowerChance: 0.2,
      maxAspect: 2.0,
    },
    roof: { kind: 'flat_eave', pitchDeg: [0, 0], eaveMm: [500, 700], parapetMm: 90, bandMm: 0, perBlock: false, terraceChance: 0.5 },
    window: {
      byRoom: { ...COMMON_BY_ROOM, living: ROOM_W.livingLarge, dining: ROOM_W.diningMod, bedroom: ROOM_W.bedroomGenerous, master: ROOM_W.master },
      fallback: ROOM_W.bedroom,
      maxWindowRatio: 0.46,
      minWallBetweenWindowsMm: 650,
      minCornerOffsetMm: 450,
      minDoorWindowDistanceMm: 400,
      stripGlazingChance: 0.55,
      pictureWindowChance: 0.4,
      upperPrivacyBias: 0.3,
    },
    door: { entryWidthMm: [1500, 1900], internalWidthMm: 900, doubleLeafEntry: true, entryCanopyMm: 0, doubleHeightEntry: true, porteCochere: false },
    balcony: { rooms: ['master', 'bedroom'], depthMm: [1200, 1600], minWidthMm: 1600, maxPerFloor: 2, recessedChance: 0.6, railStyle: 'bar', wrapVerandah: false },
    facade: {
      verticalFinsChance: 0.35,
      finDepthMm: [200, 300],
      jaaliScreenChance: 0.55,
      jaaliWhere: ['stair'],
      cladPanels: { material: 'teak', widthMm: [1500, 2000], twoStorey: true },
      featurePier: { material: 'stone_dark', chance: 0.5 },
      stringCourseMm: 40,
      chajjaMm: 520,
      plinthMm: 200,
      baseCladding: 'stone_dark',
      pergola: [],
      verandah: null,
    },
    material: {
      palette: 'grey_concrete',
      wall: '#efe9dd',
      base: '#33322f',
      trim: '#f6f4ee',
      roof: '#f4f2ec',
      frame: '#24242a',
      accent: '#96683c',
      glassTint: '#33424c',
      variants: { wall: ['#ece6d8', '#e5ddcb'], base: ['#3a3936', '#2c2b28'] },
      seededSwaps: 2,
    },
  },
}

/* ---- accessors ------------------------------------------------- */

export function styleGrammar(id: StyleId): StyleGrammar {
  return STYLE_GRAMMARS[id]
}

export function grammarForCharacter(character: Character): StyleGrammar {
  return STYLE_GRAMMARS[STYLE_OF_CHARACTER[character]]
}
