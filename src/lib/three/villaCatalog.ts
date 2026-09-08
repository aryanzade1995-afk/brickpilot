/* ------------------------------------------------------------------ *
 *  villaCatalog — the bridge between the grammar/Blender bake and the
 *  three.js viewer. Reads /villas/manifest.json (written by
 *  blender/bake/bake.mjs) and finds the closest baked GLB for a
 *  Design. Returns null when no manifest / no acceptable match, and
 *  the viewer falls back to the procedural buildMassing() path.
 *
 *  So: with no bake present the app behaves exactly as before.
 * ------------------------------------------------------------------ */

import { useEffect, useState } from 'react'
import type { Design } from '../engine/types.ts'
import { STYLE_OF_CHARACTER } from '../../architecture/grammar.ts'
import { planShapeOf } from '../../architecture/generator/classify.ts'

export type VillaEntry = {
  id: string
  style: string
  seed: number
  shape: string
  strategy: string
  floors: number
  bedrooms: number
  plotWidthMm: number
  plotDepthMm: number
  url: string
  bytes: number
}

type Manifest = { generated: string; mode: string; villas: VillaEntry[] }

/** Blender collection name  ->  the viewer's layer-toggle key */
export const GLB_LAYER: Record<string, string> = {
  Massing: 'shell',
  Walls: 'shell',
  Windows: 'glazing',
  Doors: 'glazing',
  Floors: 'slabs',
  Roofs: 'roof',
  Facade: 'roof',
  Balconies: 'metal',
  Partitions: 'partition',
}

export function layerOfNode(name: string): string | undefined {
  for (const [coll, key] of Object.entries(GLB_LAYER)) {
    if (name.startsWith(coll)) return key
  }
  return undefined
}

let cache: Promise<Manifest | null> | null = null

export function loadManifest(): Promise<Manifest | null> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL ?? '/'}villas/manifest.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
      .catch(() => null)
  }
  return cache
}

/** score a candidate against a Design — lower is better; null if unacceptable */
function score(v: VillaEntry, d: Design): number | null {
  const style = STYLE_OF_CHARACTER[d.model.brief.style.character]
  if (v.style !== style) return null
  if (v.floors !== d.floors.length) return null
  const beds = d.model.brief.rooms.bedroomsWithBath + d.model.brief.rooms.bedroomsNoBath
  const shape = planShapeOf(d.shape)
  let s = 0
  s += Math.abs(v.plotWidthMm - d.model.plot.width) / 1000
  s += Math.abs(v.plotDepthMm - d.model.plot.depth) / 1000
  s += Math.abs(v.bedrooms - beds) * 3
  s += v.shape === shape ? 0 : 2
  s += v.seed === d.model.brief.variation ? -1.5 : 0 // exact-seed bake wins
  return s <= 14 ? s : null
}

export function matchVilla(manifest: Manifest | null, design: Design | null | undefined): VillaEntry | null {
  if (!manifest || !design) return null
  let best: { v: VillaEntry; s: number } | null = null
  for (const v of manifest.villas) {
    const s = score(v, design)
    if (s == null) continue
    if (!best || s < best.s) best = { v, s }
  }
  return best?.v ?? null
}

/** hook — null until the manifest resolves and a match is found */
export function useVillaMatch(design: Design | null | undefined): VillaEntry | null {
  const [match, setMatch] = useState<VillaEntry | null>(null)
  useEffect(() => {
    let live = true
    loadManifest().then((m) => {
      if (live) setMatch(matchVilla(m, design))
    })
    return () => {
      live = false
    }
  }, [design])
  return match
}
