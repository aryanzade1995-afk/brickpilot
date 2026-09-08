import { z } from 'zod'

/** Compass edges of a plot. */
export const directionSchema = z.enum(['N', 'E', 'S', 'W'])
export type Direction = z.infer<typeof directionSchema>
export const DIRECTIONS: Direction[] = ['N', 'E', 'S', 'W']
export const DIRECTION_LABEL: Record<Direction, string> = {
  N: 'North',
  E: 'East',
  S: 'South',
  W: 'West',
}

export const buildingTypeSchema = z.enum(['villa', 'large-villa'])
export type BuildingType = z.infer<typeof buildingTypeSchema>
export const BUILDING_TYPE_LABEL: Record<BuildingType, string> = {
  villa: 'Villa / bungalow',
  'large-villa': 'Large villa',
}

/**
 * Architectural style catalogue. `character` controls only STYLE — materials,
 * roof expression, screens, columns, landscaping — never the structure (that is
 * `style.shape`). Only the two flat-roof modern styles ship: the pitched-roof
 * (Kerala), tropical and courtyard styles are retired until there is a Blender
 * bake to verify their geometry. Old ids are migrated on load.
 */
export const characterSchema = z.enum(['modern-indian', 'contemporary-indian'])
export type Character = z.infer<typeof characterSchema>

/** legacy / retired character ids → the current 2-style catalogue */
export const MIGRATE_CHARACTER: Record<string, Character> = {
  modernist: 'modern-indian',
  'warm-minimal': 'modern-indian',
  'minimal-indian': 'modern-indian',
  'modern-kerala': 'modern-indian',
  'tropical-indian': 'modern-indian',
  'kerala-contemporary': 'contemporary-indian',
  'luxury-indian': 'contemporary-indian',
  'courtyard-indian': 'contemporary-indian',
}

export const CHARACTER_LABEL: Record<Character, string> = {
  'modern-indian': 'Modern Indian',
  'contemporary-indian': 'Contemporary Indian',
}

/** footprint shape — `auto` picks by plot aspect + programme size */
export const shapeSchema = z.enum(['auto', 'square', 'rectangle', 'l-shape', 't-shape', 'u-shape', 'courtyard'])
export type ShapeChoice = z.infer<typeof shapeSchema>

/** legacy `style.massing` archetype ids → the current 6-shape vocabulary */
const MIGRATE_SHAPE: Record<string, ShapeChoice> = {
  random: 'auto',
  rectangular: 'rectangle',
  'l-shape': 'l-shape',
  't-shape': 't-shape',
  'u-shape': 'u-shape',
  courtyard: 'courtyard',
  'rear-courtyard': 'courtyard',
  'central-core': 'square',
  'side-wing': 'l-shape',
  'front-projection': 't-shape',
}

/**
 * Raw wizard input. Every leaf has a default so `briefSchema.parse({})`
 * yields a complete, valid brief.
 */
export const briefSchema = z
  .object({
    project: z
      .object({
        name: z.string().min(1).max(80).default('My family home'),
        buildingType: buildingTypeSchema.default('villa'),
      })
      .prefault({}),
    site: z
      .object({
        plotWidth: z.number().min(6).max(80).default(15),
        plotDepth: z.number().min(6).max(80).default(18),
        facing: directionSchema.default('N'),
        roadEdges: z.array(directionSchema).min(1).default(['N']),
        setbacks: z
          .object({
            N: z.number().min(0).max(20).default(3),
            E: z.number().min(0).max(20).default(1.2),
            S: z.number().min(0).max(20).default(2),
            W: z.number().min(0).max(20).default(1.2),
          })
          .prefault({}),
      })
      .prefault({}),
    spaces: z
      .object({
        occupants: z.number().int().min(1).max(20).default(4),
        stepFree: z.boolean().default(false),
        livingDining: z.enum(['separate', 'combined']).default('separate'),
      })
      .prefault({}),
    levels: z
      .object({
        storeys: z.number().int().min(0).max(3).default(1),
        floorToFloor: z.number().min(2.7).max(4).default(3.1),
        stairWidth: z.number().min(750).max(1500).default(1000),
        liftProvision: z.boolean().default(false),
      })
      .prefault({}),
    rooms: z
      .object({
        bedroomsWithBath: z.number().int().min(0).max(8).default(2),
        bedroomsNoBath: z.number().int().min(0).max(8).default(1),
        sharedBaths: z.number().int().min(0).max(6).default(1),
        studies: z.number().int().min(0).max(4).default(1),
        balcony: z.boolean().default(true),
        priorities: z
          .object({
            coveredParking: z.boolean().default(true),
            coveredVerandah: z.boolean().default(true),
            utility: z.boolean().default(true),
            pooja: z.boolean().default(true),
            courtyard: z.boolean().default(false),
            garden: z.boolean().default(true),
            compoundWall: z.boolean().default(false),
          })
          .prefault({}),
      })
      .prefault({}),
    style: z
      .object({
        character: z
          .preprocess(
            (v) => (typeof v === 'string' && v in MIGRATE_CHARACTER ? MIGRATE_CHARACTER[v] : v),
            characterSchema,
          )
          .catch('modern-indian')
          .default('modern-indian'),
        /** footprint shape — `auto` picks by plot aspect + programme size */
        shape: z
          .preprocess(
            (v) => (typeof v === 'string' && v in MIGRATE_SHAPE ? MIGRATE_SHAPE[v] : v),
            shapeSchema,
          )
          .catch('auto')
          .default('auto'),
      })
      .prefault({}),
    entry: z
      .object({
        primarySide: z.union([directionSchema, z.literal('auto')]).default('auto'),
        mainDoorWidth: z.number().min(900).max(1500).default(1200),
      })
      .prefault({}),
    /** internal variation index — bumped to reroll geometry from the same brief */
    variation: z.number().int().min(0).default(0),
  })
  .prefault({})

export type Brief = z.infer<typeof briefSchema>

export const defaultBrief = (): Brief => briefSchema.parse({})

export const BRIEF_STEPS = [
  { key: 'project', label: 'Project' },
  { key: 'site', label: 'Site' },
  { key: 'spaces', label: 'Spaces' },
  { key: 'levels', label: 'Levels' },
  { key: 'rooms', label: 'Rooms' },
  { key: 'style', label: 'Style' },
  { key: 'entry', label: 'Entry' },
  { key: 'review', label: 'Review' },
] as const

export type BriefStepKey = (typeof BRIEF_STEPS)[number]['key']
