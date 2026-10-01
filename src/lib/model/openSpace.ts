import type { Brief, Direction } from './brief.ts'

export const OPEN_SPACE_LABEL = { auto: 'Auto', perSide: 'Per side', chosenSides: 'Chosen sides', maxBuild: 'Max build' }

/** Absolute clear margins from the property edge; entered setbacks are never reduced. */
export function resolveOpenSpace(site: Brief['site']) {
  const choice = site.openSpace
  const margins = { ...site.setbacks }
  const notes: string[] = []
  for (const side of ['N', 'E', 'S', 'W'] as Direction[]) {
    const requested = choice?.mode === 'perSide' ? choice.metres[side] :
      choice?.mode === 'chosenSides' && choice.sides.includes(side) ? choice.amount : undefined
    if (requested === undefined) continue
    if (requested < site.setbacks[side]) notes.push(`${side}: ${requested.toFixed(1)} m is below the ${site.setbacks[side].toFixed(1)} m setback. The setback applies.`)
    margins[side] = Math.max(site.setbacks[side], requested)
  }
  return { margins, notes }
}
