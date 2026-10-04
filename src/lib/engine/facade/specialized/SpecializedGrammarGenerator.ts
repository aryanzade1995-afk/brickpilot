import type { BuildingModel } from '../../buildingModel.ts'
import type { VillaDesignDNA } from '../../villaDesignDna.ts'
import type { MassingModel } from '../../massing/model.ts'
import { ArchitectureValidator } from '../../massing/ArchitectureValidator.ts'
import { makeRng } from '../../massing/rng.ts'
import type { ProceduralFacadeModel } from '../proceduralTypes.ts'
import { makeBalcony } from './balconies.ts'
import { makeEntrance } from './entrances.ts'
import { makeWindows } from './windows.ts'
import { makeRoofline } from './rooflines.ts'
import { makeDepth } from './depth.ts'
import { validateSpecializedAssemblies } from './validate.ts'
import { DEFAULT_GRAMMAR_LIMITS, GRAMMAR_TYPES, type GrammarAssembly, type GrammarCategory,
  type GrammarLimits, type GrammarOptions, type SpecializedGrammarModel } from './types.ts'
import type { GrammarContext } from './context.ts'

export class SpecializedGrammarGenerator {
  static generate(building: BuildingModel, dna: VillaDesignDNA, massing: MassingModel,
    facade: ProceduralFacadeModel, options: GrammarOptions = {}, overrides: Partial<GrammarLimits> = {}): SpecializedGrammarModel {
    ArchitectureValidator.assertReadyForGeometry(building, massing)
    if (dna.sourcePlanId !== building.planId || facade.sourcePlanId !== building.planId || facade.status !== 'valid' || dna.seed !== massing.seed)
      throw new Error('Specialized grammar requires one validated plan and seed')
    const limits = { ...DEFAULT_GRAMMAR_LIMITS, ...overrides }
    if (Object.values(limits).some((n) => !Number.isFinite(n) || n <= 0)) throw new RangeError('Grammar limits must be finite positive millimetres')
    const ctx: GrammarContext = { building, dna, massing, facade, limits }
    const model: SpecializedGrammarModel = { schemaVersion: 1, sourcePlanId: building.planId, seed: dna.seed,
      status: 'valid', assemblies: [], issues: [], omissions: [], limits }
    const choose = (category: GrammarCategory, sourceId: string, recipe: (type: string) => GrammarAssembly | null) => {
      const requested = options[category]
      if (requested && !GRAMMAR_TYPES[category].some((type) => type === requested)) throw new RangeError(`Unknown ${category} grammar`)
      const rng = makeRng(dna.seed, `${building.compositionId ?? building.planId}|specialized-v1|${category}|${sourceId}`)
      const types = requested ? [requested] : [...GRAMMAR_TYPES[category]].map((type) => ({ type, key: rng.next() })).sort((a, b) => a.key - b.key).map((v) => v.type)
      for (const type of types) {
        const candidate = recipe(type)
        if (!candidate) continue
        if (!validateSpecializedAssemblies(ctx, [...model.assemblies, candidate]).length) { model.assemblies.push(candidate); return candidate }
      }
      model.omissions.push({ category, sourceId, requested: requested ?? null,
        reason: 'No compatible host/clear geometry for this choice in the authoritative plan.' })
      if (requested) { model.status = 'rejected'; model.issues.push({ code: 'GRAMMAR_UNAVAILABLE', message: `${category} ${requested} cannot fit ${sourceId}.` }) }
      return null
    }
    for (const room of building.rooms.filter((r) => r.outdoor && r.id.startsWith('balcony')))
      choose('BALCONY', room.semanticId, (type) => makeBalcony(ctx, room, type))
    for (const door of building.doors.filter((d) => d.kind === 'entry' && !d.emergencyExit)) choose('ENTRANCE', door.id!, (type) => makeEntrance(ctx, door, type))
    const used = new Set<string>()
    for (const window of building.windows) {
      if (used.has(window.id!)) continue
      const selected = choose('WINDOW', window.id!, (type) => makeWindows(ctx,
        [window, ...building.windows.filter((w) => w.id !== window.id && !used.has(w.id!))], type))
      selected?.openingIds.forEach((id) => used.add(id))
    }
    choose('ROOFLINE', building.floors.at(-1)!.id, (type) => makeRoofline(ctx, type))
    // One depth treatment complements the existing hero budget.
    const zones = facade.zones.filter((z) => z.wallId).sort((a, b) => b.endMm - b.startMm - (a.endMm - a.startMm))
    choose('DEPTH', building.planId, (type) => {
      for (const zone of zones) {
        const unit = makeDepth(ctx, zone.id, type)
        if (unit && !validateSpecializedAssemblies(ctx, [...model.assemblies, unit]).length) return unit
      }
      return null
    })
    const issues = validateSpecializedAssemblies(ctx, model.assemblies)
    if (issues.length) { model.status = 'rejected'; model.issues.push(...issues) }
    return model
  }
}
