/*
 * layouttest.mts — the real-topology layout engine's guard. For a grid of
 * seeds × shapes × bedroom counts × characters, every generated plan must:
 *   • validate hard-clean and be fully reachable
 *   • have 0 bad geometry (finite, positive, in-bounds rects)
 *   • satisfy the ResPlan invariant: every habitable room opens onto the
 *     circulation hub (or a room one door from it), no bedroom is entered only
 *     through a bathroom, and no circulation room is a dead end.
 */
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate, SHAPES } from '../src/lib/engine/index.ts'
import { validate } from '../src/lib/rules/index.ts'
import { sharedEdge, rectRight, rectBottom } from '../src/lib/geometry.ts'
import type { FloorPlan, Opening, PlacedRoom } from '../src/lib/engine/types.ts'

const CHARACTERS = ['modern-indian', 'modern-kerala', 'luxury-indian'] as const
const SHAPES_A = ['rectangle', 'square'] as const // Milestone A
void SHAPES

const rectAround = (r: PlacedRoom, o: Opening) =>
  o.at.x >= r.rect.x - 200 && o.at.x <= rectRight(r.rect) + 200 && o.at.y >= r.rect.y - 200 && o.at.y <= rectBottom(r.rect) + 200

const doorBetween = (a: PlacedRoom, b: PlacedRoom, ops: Opening[]) => {
  const e = sharedEdge(a.rect, b.rect)
  if (!e) return false
  const horiz = e.side === 'N' || e.side === 'S'
  const fixed = horiz ? e.seg.a.y : e.seg.a.x
  const lo = horiz ? Math.min(e.seg.a.x, e.seg.b.x) : Math.min(e.seg.a.y, e.seg.b.y)
  const hi = horiz ? Math.max(e.seg.a.x, e.seg.b.x) : Math.max(e.seg.a.y, e.seg.b.y)
  return ops.some((o) => {
    if (o.kind === 'window') return false
    const perp = horiz ? o.at.y : o.at.x
    const along = horiz ? o.at.x : o.at.y
    return Math.abs(perp - fixed) <= 160 && along >= lo - 150 && along <= hi + 150
  })
}

function topologyIssues(f: FloorPlan): string[] {
  const out: string[] = []
  const enc = f.rooms.filter((r) => !r.outdoor)
  const hub =
    enc.find((r) => r.id === 'living' || r.id === 'livingDining') ??
    enc.find((r) => r.id === 'familyLounge') ??
    enc.find((r) => r.id.startsWith('lobby')) ??
    enc.find((r) => r.id === 'stair')
  if (!hub) return ['no hub room']

  const adj = new Map<string, Set<string>>()
  enc.forEach((r) => adj.set(r.id, new Set()))
  for (let i = 0; i < enc.length; i++)
    for (let j = i + 1; j < enc.length; j++)
      if (doorBetween(enc[i], enc[j], f.openings)) {
        adj.get(enc[i].id)!.add(enc[j].id)
        adj.get(enc[j].id)!.add(enc[i].id)
      }

  const isBath = (r: PlacedRoom) => /bath|toilet|wc/i.test(`${r.id} ${r.name}`)
  for (const r of enc) {
    if (r.id === hub.id) continue
    const habitable = r.zone === 'private' || r.zone === 'social' || r.zone === 'work'
    if (!habitable) continue
    const nbrs = [...(adj.get(r.id) ?? [])]
    const toHub = nbrs.includes(hub.id)
    const oneOff = nbrs.some((n) => adj.get(n)?.has(hub.id) && !isBath(enc.find((x) => x.id === n)!))
    if (!toHub && !oneOff) out.push(`${r.id}: no door to the hub or a room next to it`)
    // a bedroom whose only non-bath neighbour is nothing → entered via a bath
    if (r.zone === 'private') {
      const nonBath = nbrs.filter((n) => !isBath(enc.find((x) => x.id === n)!))
      if (nonBath.length === 0) out.push(`${r.id}: entered only through a bathroom`)
    }
  }
  // circulation dead-ends — a lobby/hall that only reaches one room and isn't
  // the stair or the entry foyer (which legitimately has just the front door
  // plus one interior door)
  const hasEntry = (id: string) => f.openings.some((o) => o.kind === 'entry' && rectAround(enc.find((x) => x.id === id)!, o))
  for (const r of enc) {
    if (r.zone !== 'circulation' || r.id === 'stair' || r.id === hub.id || r.id === 'foyer') continue
    if (hasEntry(r.id)) continue
    const nbrs = [...(adj.get(r.id) ?? [])]
    if (nbrs.length <= 1 && !nbrs.includes('stair') && !nbrs.includes(hub.id)) {
      out.push(`${r.id}: dead-end circulation room`)
    }
  }
  return out
}

function badGeometry(f: FloorPlan): number {
  const o = f.outline
  return f.rooms.filter((r) => {
    if (r.outdoor) return false
    const { x, y, w, h } = r.rect
    return (
      ![x, y, w, h].every(Number.isFinite) ||
      w < 500 ||
      h < 500 ||
      x < o.x - 2 ||
      y < o.y - 2 ||
      rectRight(r.rect) > rectRight(o) + 2 ||
      rectBottom(r.rect) > rectBottom(o) + 2
    )
  }).length
}

let cases = 0
let bad = 0
const shapeSeen = new Set<string>()

for (const shape of [...SHAPES_A, 'auto'] as const) {
  for (let beds = 1; beds <= 4; beds++) {
    for (const character of CHARACTERS) {
      for (let seed = 0; seed < 6; seed++) {
        const b = defaultBrief()
        b.style.shape = shape
        b.style.character = character
        b.levels.storeys = beds >= 3 ? 2 : 1
        b.rooms.bedroomsWithBath = Math.min(beds, 2)
        b.rooms.bedroomsNoBath = Math.max(0, beds - 2)
        b.rooms.studies = beds >= 3 ? 1 : 0
        // keep the plot deep enough that a shape choice can actually be honoured
        b.site.plotWidth = 15 + (seed % 3) * 3
        b.site.plotDepth = 20 + (seed % 3) * 4
        b.variation = seed * 101 + beds * 7

        const d = generate(compile(b))
        shapeSeen.add(d.shape)
        const rep = validate(d)
        const reach = d.floors.every((f) => f.reachable)
        const geo = d.floors.reduce((n, f) => n + badGeometry(f), 0)
        const topo = d.floors.flatMap((f) => topologyIssues(f).map((m) => `${f.name}: ${m}`))
        cases++
        const fail: string[] = []
        if (!rep.hardChecksPass) fail.push(`hardPass N (${rep.findings.filter((x) => x.severity === 'error').map((x) => x.code).join(',')})`)
        if (!reach) fail.push('unreachable')
        if (geo) fail.push(`${geo} bad rects`)
        if (topo.length) fail.push(...topo)
        if (fail.length) {
          bad++
          console.log(`✗ ${shape} ${beds}BR ${character} seed${seed}: ${fail.join(' | ')}`)
        }
      }
    }
  }
}

console.log(`\n${cases} cases, ${bad} bad`)
console.log(`shapes exercised: ${[...shapeSeen].join(', ')}`)
if (bad > 0) process.exit(1)
