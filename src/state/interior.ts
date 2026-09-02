import { create } from 'zustand'
import type { CaptureMaps } from '@/lib/render/RoomViewport.tsx'

/* ------------------------------------------------------------------ *
 *  AI interior render state. Ephemeral — the 3D captures and the
 *  generated images are large PNGs and never touch persistence. The
 *  model/provider lives entirely behind /api/interior.
 * ------------------------------------------------------------------ */

export type InteriorPhase = 'idle' | 'capturing' | 'generating' | 'done' | 'error'
export type Progress = { pct: number; stage: string }
export type InteriorHealth = { provider: string; reachable: boolean; note?: string }

export type InteriorResult = {
  id: string
  /** one generated image per camera POV (primary first) */
  urls: string[]
  maps: CaptureMaps[]
  positive: string
  negative: string
  styleId: string
  roomLabel: string
  seed?: number
  at: number
}

export type GeneratePayload = {
  /** one CaptureMaps per camera POV — a separate render job runs for each */
  maps: CaptureMaps[]
  positive: string
  negative: string
  styleId: string
  roomLabel: string
  params?: Record<string, number | string>
}

type InteriorState = {
  roomKey: string | null
  styleId: string
  phase: InteriorPhase
  progress: Progress
  error: string | null
  results: InteriorResult[]
  health: InteriorHealth | null

  setRoom: (key: string) => void
  setStyle: (id: string) => void
  probeHealth: () => Promise<void>
  generate: (payload: GeneratePayload) => Promise<void>
  removeResult: (id: string) => void
  reset: () => void
}

function parseSse(chunk: string): { event: string; data: string } {
  let event = 'message'
  let data = ''
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  return { event, data }
}

export const useInterior = create<InteriorState>((set, get) => ({
  roomKey: null,
  styleId: 'modern-indian',
  phase: 'idle',
  progress: { pct: 0, stage: '' },
  error: null,
  results: [],
  health: null,

  setRoom: (key) => set({ roomKey: key }),
  setStyle: (id) => set({ styleId: id }),

  probeHealth: async () => {
    try {
      const res = await fetch('/api/interior/health')
      const j = await res.json()
      set({ health: { provider: j.provider ?? 'unknown', reachable: !!j.reachable, note: j.note } })
    } catch {
      set({ health: { provider: 'offline', reachable: false, note: 'proxy unreachable — run `npm run dev`' } })
    }
  },

  generate: async (payload) => {
    const povs = payload.maps
    const n = Math.max(1, povs.length)
    set({ phase: 'generating', progress: { pct: 2, stage: n > 1 ? 'submitting view 1' : 'submitting' }, error: null })
    try {
      const urls: string[] = []
      let firstSeed: number | undefined

      for (let i = 0; i < n; i++) {
        const m = povs[i]
        const label = n > 1 ? `view ${i + 1}/${n} · ` : ''
        const band = (p: number) => Math.round(((i + Math.min(1, Math.max(0, p / 100))) / n) * 100)

        const res = await fetch('/api/interior', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            beauty: m.beauty.split(',')[1],
            depth: m.depth.split(',')[1],
            edge: m.edge.split(',')[1],
            positive: payload.positive,
            negative: payload.negative,
            params: payload.params ?? {},
          }),
        })
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j?.error || `interior render failed (${res.status})`)
        }

        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        let done: { imageBase64: string; mimeType?: string; meta?: Record<string, unknown> } | null = null

        for (;;) {
          const { done: streamDone, value } = await reader.read()
          if (streamDone) break
          buf += dec.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          for (const part of parts) {
            if (!part.trim()) continue
            const { event, data } = parseSse(part)
            if (!data) continue
            const j = JSON.parse(data)
            if (event === 'progress') {
              set({ progress: { pct: band(j.pct ?? 0), stage: `${label}${j.stage ?? ''}` } })
            } else if (event === 'done') {
              done = j
            } else if (event === 'error') {
              throw new Error(j.error || 'generation error')
            }
          }
        }

        if (!done?.imageBase64) throw new Error('no image returned')
        urls.push(`data:${done.mimeType || 'image/png'};base64,${done.imageBase64}`)
        if (i === 0 && typeof done.meta?.seed === 'number') firstSeed = done.meta.seed as number
      }

      const result: InteriorResult = {
        id: `${Date.now()}`,
        urls,
        maps: povs,
        positive: payload.positive,
        negative: payload.negative,
        styleId: payload.styleId,
        roomLabel: payload.roomLabel,
        seed: firstSeed,
        at: Date.now(),
      }
      set((s) => ({ phase: 'done', progress: { pct: 100, stage: 'done' }, results: [result, ...s.results] }))
    } catch (e) {
      set({ phase: 'error', error: String((e as Error).message) })
    }
  },

  removeResult: (id) => set((s) => ({ results: s.results.filter((r) => r.id !== id) })),

  reset: () =>
    set({ phase: 'idle', progress: { pct: 0, stage: '' }, error: null, results: [], roomKey: get().roomKey }),
}))
