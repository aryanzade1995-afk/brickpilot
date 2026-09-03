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
 * `style.massing`). New styles are additive; the three legacy ids are migrated
 * on load (see `MIGRATE_CHARACTER` + `studio.ts`).
 */
export const characterSchema = z.enum([
  'modern-indian',
  'contemporary-indian',
  'modern-kerala',
  'kerala-contemporary',
  'luxury-indian',
  'tropical-indian',
  'minimal-indian',
  'courtyard-indian',
])
export type Character = z.infer<typeof characterSchema>

/** legacy character ids → the current catalogue */
export const MIGRATE_CHARACTER: Record<string, Character> = {
  modernist: 'modern-indian',
  'warm-minimal': 'minimal-indian',
  'kerala-contemporary': 'kerala-contemporary',
}

export const CHARACTER_LABEL: Record<Character, string> = {
  'modern-indian': 'Modern Indian',
  'contemporary-indian': 'Contemporary Indian',
  'modern-kerala': 'Modern Kerala',
  'kerala-contemporary': 'Kerala Contemporary',
  'luxury-indian': 'Luxury Indian villa',
  'tropical-indian': 'Tropical Indian modern',
  'minimal-indian': 'Minimal Indian',
  'courtyard-indian': 'Courtyard Indian modern',
}

export const massingSchema = z.enum([
  'auto',
  'random',
  'rectangular',
  'l-shape',
  't-shape',
  'u-shape',
  'courtyard',
  'rear-courtyard',
  'offset-box',
  'split-volume',
  'cantilever',
  'stepped',
  'interlocking',
  'central-core',
  'side-wing',
  'front-projection',
  'asymmetric',
])
export type MassingChoice = z.infer<typeof massingSchema>

export const diversitySchema = z.enum(['low', 'medium', 'high', 'extreme'])

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
          .default('modern-indian'),
        /** architectural massing archetype — `auto` picks by fit, `random` re-rolls */
        massing: massingSchema.default('auto'),
        /** how far the massing grammar pushes offsets / cantilevers / asymmetry */
        diversity: diversitySchema.default('medium'),
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
