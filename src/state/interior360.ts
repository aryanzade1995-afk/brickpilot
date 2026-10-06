import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** The 360 previews a person has made, kept across visits: the panorama files stay in the server's cache, this remembers
 *  which one belongs to which room and finishes, and the panel's own choices (style, lighting, furniture, quality). */
export type SavedPanorama = { url: string; initialYaw: number; savedAt: string }
type State = {
  style: string
  lighting: string
  furnitureDensity: string
  quality: 'fast' | 'high'
  room: { floor: number; roomId: string } | null
  saved: Record<string, SavedPanorama>
  set: (patch: Partial<Omit<State, 'set' | 'remember' | 'forget'>>) => void
  remember: (key: string, pano: Omit<SavedPanorama, 'savedAt'>) => void
  forget: (key: string) => void
}

export const useInterior360 = create<State>()(persist((set) => ({
  style: 'modern', lighting: 'warm', furnitureDensity: 'medium', quality: 'fast', room: null, saved: {},
  set: (patch) => set(patch),
  // keep the most recent 60 previews
  remember: (key, pano) => set((s) => ({ saved: Object.fromEntries([...Object.entries(s.saved).filter(([k]) => k !== key), [key, { ...pano, savedAt: new Date().toISOString() }]].slice(-60)) })),
  forget: key => set(s => ({saved: Object.fromEntries(Object.entries(s.saved).filter(([k]) => k !== key))})),
}), { name: 'brickpilot.interior360.v1' }))
