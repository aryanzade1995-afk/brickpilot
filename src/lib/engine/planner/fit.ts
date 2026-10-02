import { generate } from '../generate.ts'
import { validate } from '../../rules/index.ts'
import type { Brief } from '../../model/brief.ts'
import { briefSiteIssues, compile } from '../../model/canonical.ts'
import type { PlateFamily } from './types.ts'
import { normalizeBrief, programRequirements, siteModel, snapUp, stairGeometry } from './program.ts'
import { plateCandidates, type LayoutInput } from './layout.ts'

export type BriefFit = {
  fits: boolean
  atTarget: boolean
  plotSqm: number
  buildableWidthM: number
  buildableDepthM: number
  busiestFloor: string
  minimumSqm: number
  issues: string[]
}

const FAMILY: Record<string, PlateFamily> = {
  'twin-wing': 'twin-wing',
  'u-wing':'u-wing','courtyard-ring':'courtyard-ring',pavilion:'pavilion',
  rectangular: 'rectangular', 'central-core': 'rectangular',
  stepped: 'stepped', 'offset-box': 'stepped', cantilever: 'stepped',
  'split-volume': 'stepped', 'side-wing': 'stepped',
  'l-shape': 'l-shape', 't-shape': 'l-shape',
  'front-projection': 'l-shape', interlocking: 'l-shape', asymmetric: 'l-shape',
  courtyard: 'courtyard', 'rear-courtyard': 'courtyard', 'u-shape': 'courtyard',
}

/** Quick fit check for the brief form. Uses the same plate sizing as planVilla,
 *  without running door placement, access checks or 3D generation. */
function packingFit(brief: Brief): BriefFit {
  const model = compile(brief)
  const busiest = model.floors.map((floor) => ({
    name: floor.name,
    minimum: floor.spaces.filter((space) => !space.outdoor).reduce((sum, space) => sum + space.min, 0),
  })).sort((a, b) => b.minimum - a.minimum)[0]
  const result: BriefFit = {
    fits: false,
    atTarget: false,
    plotSqm: brief.site.plotWidth * brief.site.plotDepth,
    buildableWidthM: model.envelope.width / 1000,
    buildableDepthM: model.envelope.depth / 1000,
    busiestFloor: busiest.name,
    minimumSqm: Math.round(busiest.minimum),
    issues: briefSiteIssues(brief),
  }
  if (result.issues.length) return result
  if (['twin-wing','u-wing','courtyard-ring','pavilion'].includes(brief.style.massing) ||
    ((brief.style.massing==='auto'||brief.style.massing==='random')&&brief.project.buildingType==='large-villa'&&
      model.envelope.width*model.envelope.depth>=600e6)) {
    // Multi-wing capacity is proved by the production planner below, not the bar packer.
    result.fits = true
    return result
  }

  const nb = normalizeBrief(model)
  const stair = stairGeometry(nb)
  const requested = brief.style.massing
  const family = brief.rooms.priorities.courtyard ? 'courtyard' :
    requested === 'auto' || requested === 'random' ? 'rectangular' : FAMILY[requested]
  const hallMm = snapUp(Math.max(1800, nb.mainDoorMm + 600))

  for (const yard of ['front', 'side'] as const) {
    const site = siteModel(model, yard)
    for (const singleLoaded of [false, true]) {
      const floors = programRequirements(nb, stair.slotWidth, singleLoaded)
      const court = floors[0].outdoor.find((room) => room.kind === 'courtyard')
      const input: LayoutInput = {
        floors, site, family, large: nb.large, stairDepth: stair.depth,
        hasStair: floors[0].rooms.some((room) => room.kind === 'stair'),
        courtSqm: court?.targetSqm ?? 12,
        singleLoaded, hallMm,
      }
      const candidates = plateCandidates(input).filter((candidate) => !candidate.relaxed && candidate.atMin)
      if (candidates.length) {
        result.fits = true
        result.atTarget ||= candidates.some((candidate) => candidate.atTarget)
      }
    }
  }
  return result
}

// Cache identical checks across wizard panels and counter previews. Never persist plans here.
const capacityCache = new Map<string, BriefFit>()
export const CAPACITY_GUIDANCE = 'Add a floor, enlarge the plot or reduce open space to add another room or member.'
/** A brief is allowed only when the SAME production planner passes every hard check. */
export function assessBriefFit(brief: Brief): BriefFit {
  const key = JSON.stringify(brief)
  const cached = capacityCache.get(key)
  if (cached) return cached
  const fit = packingFit(brief)
  if (fit.fits) {
    try {
      const report = validate(generate(compile(brief)))
      fit.fits = report.hardChecksPass
      if (!fit.fits) fit.issues = report.findings.filter(f => f.severity === 'error').map(f => f.message)
    } catch (error) {
      fit.fits = false
      fit.issues = [error instanceof Error ? error.message : 'No valid layout fits these requirements.']
    }
  }
  if (capacityCache.size >= 64) capacityCache.delete(capacityCache.keys().next().value!)
  capacityCache.set(key, fit)
  return fit
}
/** The plan shapes the Style step offers (besides Auto): each a really
 *  different plate, not another label for the same one. */
export const SHAPE_CHOICES = ['twin-wing','u-wing','courtyard-ring','pavilion'] as const
export type ShapeChoice = (typeof SHAPE_CHOICES)[number]
export type ShapeCheck = { ok: boolean; reason: string }

const shapeCache = new Map<string, ShapeCheck>()
/** Does the production planner really build this shape for this brief? The
 *  plan must pass every hard check AND come out as the asked-for shape. */
export function assessShape(brief: Brief, shape: ShapeChoice): ShapeCheck {
  const key = shape + JSON.stringify(brief)
  const cached = shapeCache.get(key)
  if (cached) return cached
  let check: ShapeCheck
  try {
    const trial = structuredClone(brief)
    trial.style.massing = shape
    const plan = generate(compile(trial), { massing: shape })
    check = !validate(plan).hardChecksPass
      ? { ok: false, reason: 'No valid plan of this shape fits the plot and rooms.' }
      : plan.massingType !== shape
        ? { ok: false, reason: `The plot only takes a ${plan.massingType.replace('-', ' ')} plan.` }
        : { ok: true, reason: 'Checked: builds a valid plan of this shape.' }
  } catch (error) {
    check = { ok: false, reason: error instanceof Error ? error.message : 'No valid plan of this shape.' }
  }
  if (shapeCache.size >= 96) shapeCache.delete(shapeCache.keys().next().value!)
  shapeCache.set(key, check)
  return check
}

export function canIncreaseBrief(brief: Brief, recipe: (candidate: Brief) => void): boolean {
  const candidate = structuredClone(brief)
  recipe(candidate)
  return assessBriefFit(candidate).fits
}
