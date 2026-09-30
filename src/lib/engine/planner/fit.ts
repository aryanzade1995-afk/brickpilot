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
  rectangular: 'rectangular', 'central-core': 'rectangular',
  stepped: 'stepped', 'offset-box': 'stepped', cantilever: 'stepped',
  'split-volume': 'stepped', 'side-wing': 'stepped',
  'l-shape': 'l-shape', 't-shape': 'l-shape',
  'front-projection': 'l-shape', interlocking: 'l-shape', asymmetric: 'l-shape',
  courtyard: 'courtyard', 'rear-courtyard': 'courtyard', 'u-shape': 'courtyard',
}

/** Quick fit check for the brief form. Uses the same plate sizing as planVilla,
 *  without running door placement, access checks or 3D generation. */
export function assessBriefFit(brief: Brief): BriefFit {
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
