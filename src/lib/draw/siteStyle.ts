import type { SiteFeature } from '../engine/types.ts'

type Kind = SiteFeature['kind']

/** One look per kind of site feature, shared by the drawing, the editor and its legend, so each is recognisable at a glance. */
export const SITE_STYLE: Record<Kind, { name: string; short: string; alt?: string; fill: string; edge: string; dark: string }> = {
  lawn: { name: 'Garden', short: 'GARDEN', fill: '#dde6d3', edge: '#dde6d3', dark: '#29382e' },
  driveway: { name: 'Driveway', short: 'DRIVEWAY', fill: '#cfccc6', edge: '#a8a49c', dark: '#4a4f55' },
  path: { name: 'Path', short: 'PATH', fill: '#eadfc9', edge: '#c9b893', dark: '#55503f' },
  utilityYard: { name: 'Utility yard', short: 'UTILITY YARD', alt: 'YARD', fill: '#d9e1ea', edge: '#9eb0c4', dark: '#3a4652' },
  sitOut: { name: 'Sit-out', short: 'SIT-OUT', fill: '#f0e2c6', edge: '#cfb27a', dark: '#5a4c33' },
  pool: { name: 'Pool', short: 'POOL', fill: '#b5d8e6', edge: '#6fa9c0', dark: '#254452' },
  parking: { name: 'Parking', short: 'PARKING', fill: '#d6d3cd', edge: '#a8a49c', dark: '#3a424a' },
}

export const siteName = (kind: string) => SITE_STYLE[kind as Kind]?.name ?? kind

/** a label that fits inside its area: turned upright on a long narrow strip, left out when even that would not fit */
export function fitLabel(rect: { x: number; y: number; w: number; h: number }, text: string, max = 260) {
  const across = Math.min(max, rect.w / (text.length * 0.68), rect.h * 0.45)
  const upright = Math.min(max, rect.h / (text.length * 0.68), rect.w * 0.45)
  const turn = upright > across * 1.25
  const size = turn ? upright : across
  if (size < 110) return null
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, size, rotate: turn ? -90 : 0 }
}
