/* ------------------------------------------------------------------ *
 *  villaCatalog — the bridge between the architectural grammar /
 *  Blender bake and the three.js viewer.
 *
 *  For a Design it computes the DesignSpec (grammar), asks the backend
 *  `POST /api/generate` for a GLB, and — if that is unavailable (pure
 *  static hosting) — falls back to matching /villas/manifest.json
 *  directly. With no bake present at all it returns null and the
 *  viewer keeps using the procedural buildMassing() path unchanged.
 * ------------------------------------------------------------------ */

import { useEffect, useMemo, useState } from 'react'
import type { Design } from '../engine/types.ts'
import { specFromDesign } from '../../architecture/generateDesign.ts'
import { STYLE_OF_CHARACTER } from '../../architecture/grammar.ts'
import { planShapeOf } from '../../architecture/generator/classify.ts'
import type { DesignSpec } from '../../architecture/types.ts'

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
  Stairs: 'stair',
  Balconies: 'metal',
  Partitions: 'partition',
}

export function layerOfNode(name: string): string | undefined {
  for (const [coll, key] of Object.entries(GLB_LAYER)) {
    if (name.startsWith(coll)) return key
  }
  return undefined
}

const BASE = import.meta.env.BASE_URL ?? '/'
let manifestCache: Promise<Manifest | null> | null = null

function loadManifest(): Promise<Manifest | null> {
  if (!manifestCache) {
    manifestCache = fetch(`${BASE}villas/manifest.json`, { cache: 'no-cache' })
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? (r.json() as Promise<Manifest>) : null))
      .catch(() => null)
  }
  return manifestCache
}

function scoreEntry(v: VillaEntry, d: Design): number | null {
  if (v.style !== STYLE_OF_CHARACTER[d.model.brief.style.character]) return null
  if (v.floors !== d.floors.length) return null
  const beds = d.model.brief.rooms.bedroomsWithBath + d.model.brief.rooms.bedroomsNoBath
  let s = 0
  s += Math.abs(v.plotWidthMm - d.model.plot.width) / 1000
  s += Math.abs(v.plotDepthMm - d.model.plot.depth) / 1000
  s += Math.abs(v.bedrooms - beds) * 3
  s += v.shape === planShapeOf(d.shape) ? 0 : 2
  s += v.seed === d.model.brief.variation ? -1.5 : 0
  return s <= 14 ? s : null
}

async function matchStatic(design: Design): Promise<string | null> {
  const m = await loadManifest()
  if (!m) return null
  let best: { v: VillaEntry; s: number } | null = null
  for (const v of m.villas) {
    const s = scoreEntry(v, design)
    if (s == null) continue
    if (!best || s < best.s) best = { v, s }
  }
  return best ? `${BASE}${best.v.url}` : null
}

async function askBackend(spec: DesignSpec): Promise<string | null> {
  try {
    const r = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec }),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { glbUrl?: string | null }
    return j.glbUrl ? `${BASE}${j.glbUrl}` : null
  } catch {
    return null
  }
}

export type VillaGlb = { url: string; spec: DesignSpec } | null

/** hook — the DesignSpec is derived synchronously; the GLB url resolves async */
export function useVillaGlb(design: Design | null | undefined): { glb: VillaGlb; spec: DesignSpec | null } {
  const spec = useMemo(() => (design ? specFromDesign(design) : null), [design])
  const [resolved, setResolved] = useState<{ id: string; url: string } | null>(null)

  useEffect(() => {
    if (!design || !spec) return
    let live = true
    ;(async () => {
      const url = (await askBackend(spec)) ?? (await matchStatic(design))
      if (live && url) setResolved({ id: spec.id, url })
    })()
    return () => {
      live = false
    }
  }, [design, spec])

  // only surface the GLB once it belongs to the CURRENT spec (avoids a stale flash)
  const glb: VillaGlb = spec && resolved && resolved.id === spec.id ? { url: resolved.url, spec } : null
  return { glb, spec }
}
