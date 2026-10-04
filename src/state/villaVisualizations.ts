import {create} from 'zustand'
import type {VillaVisualizationPair} from '../lib/render/villaVisualizations.ts'
/** Ephemeral images keyed by the exact source model; never persisted into localStorage. */
export const useVillaVisualizations=create<{pairs:Record<string,VillaVisualizationPair>;save:(pair:VillaVisualizationPair)=>void;reset:()=>void}>(set=>({
  pairs:{},save:pair=>set(s=>({pairs:{...Object.fromEntries(Object.entries(s.pairs).slice(-5)),[pair.sourceId]:pair}})),reset:()=>set({pairs:{}})
}))
