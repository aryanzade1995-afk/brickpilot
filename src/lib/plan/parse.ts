import type { Rect } from '../geometry.ts'
import type { LayoutDoc, LayoutRoom } from './layout.ts'
import { ADDABLE_TYPES, type RoomType } from './roomTypes.ts'

/* A saved layout is read back defensively: anything malformed is dropped, never trusted. */

const TYPES = new Set<string>([...ADDABLE_TYPES, 'open', 'vacant', 'fixed', 'parking', 'verandah', 'balcony', 'courtyard'])
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const rect = (v: unknown): v is Rect => !!v && typeof v === 'object' && num((v as Rect).x) && num((v as Rect).y) && num((v as Rect).w) && num((v as Rect).h) && (v as Rect).w > 0 && (v as Rect).h > 0

function room(v: unknown): LayoutRoom | null {
  const r = v as Partial<LayoutRoom> | null
  if (!r || typeof r !== 'object') return null
  if (typeof r.id !== 'string' || typeof r.semanticId !== 'string' || typeof r.name !== 'string' || typeof r.kind !== 'string' || typeof r.zone !== 'string') return null
  if (typeof r.type !== 'string' || !TYPES.has(r.type) || !rect(r.rect) || !r.constraints || typeof r.constraints !== 'object') return null
  const c = r.constraints
  if (![c.minSqm, c.targetSqm, c.maxSqm, c.minWidthMm, c.doors].every(num)) return null
  return { ...(r as LayoutRoom), type: r.type as RoomType | 'fixed', locked: r.locked === true, fixed: r.fixed === true }
}

export function parseLayout(value: unknown): LayoutDoc | null {
  const v = value as Partial<LayoutDoc> | null
  if (!v || v.version !== 1 || typeof v.signature !== 'string' || !Array.isArray(v.floors)) return null
  const floors: LayoutDoc['floors'] = []
  for (const f of v.floors) {
    if (!f || !num((f as { level: unknown }).level) || !Array.isArray((f as { rooms: unknown }).rooms)) return null
    const rooms = (f as { rooms: unknown[] }).rooms.map(room)
    if (rooms.some((r) => r === null)) return null
    floors.push({ level: (f as { level: number }).level, rooms: rooms as LayoutRoom[] })
  }
  const o = (v as { outline?: Record<string, unknown> }).outline
  const outline = o && ['N', 'S', 'E', 'W'].every((k) => num(o[k])) ? { N: o.N as number, S: o.S as number, E: o.E as number, W: o.W as number } : undefined
  const feats = (v as { features?: Record<string, unknown> }).features
  const features = feats && typeof feats === 'object' ? Object.fromEntries(Object.entries(feats).filter(([, r]) => rect(r))) as LayoutDoc['features'] : undefined
  return { version: 1, signature: v.signature, floors, ...(outline ? { outline } : {}), ...(features && Object.keys(features).length ? { features } : {}) }
}
