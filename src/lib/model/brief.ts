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
  'resort-luxury',
  'neo-classical',
  'contemporary-classical',
  'urban-premium',
  'modern-box',
])
export type Character = z.infer<typeof characterSchema>

/** Current choices for new designs. Keep the full schema for saved projects. */
export const SELECTABLE_CHARACTERS = [
  'modern-box', 'contemporary-indian', 'courtyard-indian',
] as const satisfies readonly Character[]

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
  'resort-luxury': 'Resort villa',
  'neo-classical': 'Neo Classical',
  'contemporary-classical': 'Contemporary Classical',
  'urban-premium': 'Urban Premium',
  'modern-box': 'Modern box',
}

export const massingSchema = z.enum([
  'twin-wing',
  'u-wing', 'courtyard-ring', 'pavilion',
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
export const personalitySchema = z.enum(['balanced', 'minimal', 'elegant', 'bold', 'dramatic', 'warm', 'luxurious', 'tropical'])
export type DesignPersonality = z.infer<typeof personalitySchema>

/* ---------------------- household / lifestyle ---------------------- */

export const memberRoleSchema = z.enum(['adult', 'senior', 'teen', 'child', 'infant'])
export type MemberRole = z.infer<typeof memberRoleSchema>
export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  adult: 'Adult',
  senior: 'Senior',
  teen: 'Teen',
  child: 'Child',
  infant: 'Infant',
}

/** a senior needs the ground floor unless the brief says otherwise */
export const memberSchema = z.preprocess(
  (v) =>
    v && typeof v === 'object' && !('needsGroundFloor' in v) && (v as { role?: unknown }).role === 'senior'
      ? { ...v, needsGroundFloor: true }
      : v,
  z.object({
    role: memberRoleSchema.default('adult'),
    needsGroundFloor: z.boolean().default(false),
  }),
)
export type Member = z.infer<typeof memberSchema>

export const guestsSchema = z.enum(['rare', 'occasional', 'frequent'])
export type Guests = z.infer<typeof guestsSchema>
export const GUESTS_LABEL: Record<Guests, string> = {
  rare: 'Rarely',
  occasional: 'Occasionally',
  frequent: 'Frequently',
}

export const staffSchema = z.enum(['none', 'daily', 'liveIn'])
export type Staff = z.infer<typeof staffSchema>
export const STAFF_LABEL: Record<Staff, string> = {
  none: 'None',
  daily: 'Daily help',
  liveIn: 'Live-in staff',
}

export const kitchenSchema = z.enum(['open', 'semi', 'closed'])
export type KitchenType = z.infer<typeof kitchenSchema>
export const KITCHEN_LABEL: Record<KitchenType, string> = {
  open: 'Open',
  semi: 'Semi-open',
  closed: 'Closed',
}

export const vastuSchema = z.enum(['ignore', 'prefer', 'strict'])
export type VastuPreference = z.infer<typeof vastuSchema>
export const VASTU_LABEL: Record<VastuPreference, string> = {
  ignore: 'Ignore',
  prefer: 'Prefer',
  strict: 'Strict',
}

export const finishSchema = z.enum(['basic', 'mid', 'premium'])
export type Finish = z.infer<typeof finishSchema>
export const FINISH_LABEL: Record<Finish, string> = {
  basic: 'Basic',
  mid: 'Mid-range',
  premium: 'Premium',
}

const DEFAULT_MEMBERS: Member[] = [
  { role: 'adult', needsGroundFloor: false },
  { role: 'adult', needsGroundFloor: false },
  { role: 'child', needsGroundFloor: false },
  { role: 'child', needsGroundFloor: false },
]

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
        autoExtras: z.boolean().default(true),
      })
      .prefault({}),
    site: z
      .object({
        plotWidth: z.number().min(6).max(80).default(15),
        plotDepth: z.number().min(6).max(80).default(18),
        facing: directionSchema.default('N'),
        roadEdges: z.array(directionSchema).min(1).default(['N']),
        openSpace: z.object({
          mode: z.enum(['auto', 'perSide', 'chosenSides', 'maxBuild']).default('auto'),
          metres: z.object({ N: z.number().min(0).max(30).default(3), E: z.number().min(0).max(30).default(1.2), S: z.number().min(0).max(30).default(2), W: z.number().min(0).max(30).default(1.2) }).prefault({}),
          sides: z.array(directionSchema).default(['N']),
          amount: z.number().min(0).max(30).default(3),
        }).prefault({}),
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
        pool: z.boolean().default(false),
        poojaPreference: z.enum(['compact', 'dedicated', 'large']).default('dedicated'),
        poojaSide: z.union([directionSchema, z.literal('auto')]).default('auto'),
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
          // new briefs start as the white modern box; saved briefs keep their style
          .default('modern-box'),
        /** architectural massing archetype — `auto` picks by fit, `random` re-rolls */
        massing: massingSchema.default('auto'),
        /** how far the massing grammar pushes offsets / cantilevers / asymmetry */
        diversity: diversitySchema.default('medium'),
        personality: personalitySchema.default('balanced'),
      })
      .prefault({}),
    entry: z
      .object({
        primarySide: z.union([directionSchema, z.literal('auto')]).default('auto'),
        mainDoorWidth: z.number().min(900).max(1800).default(1500).transform(v => Math.max(1200, v)),
        design: z.enum(['auto', 'indian-carved', 'wide-pivot', 'framed-portico', 'stone-surround']).default('auto'),
      })
      .prefault({}),
    household: z
      .object({
        members: z.array(memberSchema).min(1).max(20).default(() => DEFAULT_MEMBERS.map((m) => ({ ...m }))),
        guests: guestsSchema.default('occasional'),
        staff: staffSchema.default('none'),
      })
      .prefault({}),
    lifestyle: z
      .object({
        kitchen: kitchenSchema.default('semi'),
        dryWetSplit: z.boolean().default(false),
        wfhCount: z.number().int().min(0).max(4).default(0),
        clientVisits: z.boolean().default(false),
        vastu: vastuSchema.default('prefer'),
      })
      .prefault({}),
    /** Finish/specification preferences are downstream of geometry and never seed it. */
    finish: finishSchema.default('mid'),
    specs: z.object({ overrides: z.record(z.string().min(1).max(160), z.string().min(1).max(100)).default({}) }).prefault({}),
    /** internal variation index — bumped to reroll geometry from the same brief */
    variation: z.number().int().min(0).default(0),
  })
  .prefault({})

export type Brief = z.infer<typeof briefSchema>

export const defaultBrief = (): Brief => briefSchema.parse({})

/** Excludes cost preferences, preserving pre-specification saved-project seeds. */
export function geometryBrief(brief: Brief) {
  const { finish: _finish, specs: _specs, ...geometry } = brief
  return geometry
}

/** people in the household — `spaces.occupants` is kept only for old briefs */
export const occupantCount = (brief: Brief): number => brief.household.members.length

export const BRIEF_STEPS = [
  { key: 'project', label: 'Project' },
  { key: 'site', label: 'Site' },
  { key: 'spaces', label: 'Household' },
  { key: 'levels', label: 'Levels' },
  { key: 'rooms', label: 'Rooms' },
  { key: 'style', label: 'Style' },
  { key: 'entry', label: 'Entry' },
  { key: 'review', label: 'Review' },
] as const

export type BriefStepKey = (typeof BRIEF_STEPS)[number]['key']
