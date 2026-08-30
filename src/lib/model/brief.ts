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

export const buildingTypeSchema = z.enum(['villa'])
export const characterSchema = z.enum(['modernist', 'warm-minimal', 'kerala-contemporary'])
export const CHARACTER_LABEL: Record<z.infer<typeof characterSchema>, string> = {
  modernist: 'Modernist',
  'warm-minimal': 'Warm minimal',
  'kerala-contemporary': 'Kerala contemporary',
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
          })
          .prefault({}),
      })
      .prefault({}),
    style: z
      .object({
        character: characterSchema.default('modernist'),
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
