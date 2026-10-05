/* Local SDXL (ComfyUI, edge-conditioned so the room keeps its walls and openings) is the primary
 * engine: lightweight and fast. Gemini Web is the fallback when it is offline or fails. */
import * as comfyui from './comfyui.mjs'
import * as geminiWeb from './gemini-web.mjs'
import * as gemini from './gemini.mjs'
import * as mock from './mock.mjs'

const REGISTRY = { 'gemini-web': geminiWeb, comfyui, gemini, mock }

/** IMAGE_ENGINE=gemini-web puts Gemini first everywhere; the default is local SDXL first. */
export const geminiFirst = () => (process.env.IMAGE_ENGINE || '').toLowerCase() === 'gemini-web'

export function providerName() {
  const name = (process.env.INTERIOR_PROVIDER || 'comfyui').toLowerCase()
  return REGISTRY[name] ? name : 'comfyui'
}

export async function resolveProvider() {
  const configuredId = providerName()
  const chosen = REGISTRY[configuredId]
  const health = await chosen.healthy().catch(() => ({ reachable: false, note: 'health check failed' }))
  if (health.reachable || configuredId === 'mock')
    return { configuredId, activeId: configuredId, reachable: !!health.reachable,
      note: health.note || '', provider: chosen, usingMock: configuredId === 'mock' }

  const other = configuredId === 'comfyui' ? geminiWeb : comfyui
  const otherId = configuredId === 'comfyui' ? 'gemini-web' : 'comfyui'
  if (configuredId !== 'mock') {
    const fallback = await other.healthy().catch(() => ({ reachable: false, note: 'health check failed' }))
    if (fallback.reachable)
      return { configuredId, activeId: otherId, reachable: true,
        note: `${configuredId} unavailable (${health.note || 'offline'}); using ${otherId}`,
        provider: other, usingMock: false }
  }
  return { configuredId, activeId: 'unavailable', reachable: false,
    note: `${configuredId} unavailable (${health.note || 'offline'}); ${otherId} also unavailable.`,
    provider: null, usingMock: false }
}

export async function generateInteriorWithFallback(job, onFallback) {
  const selected = await resolveProvider()
  if (!selected.reachable || !selected.provider) throw new Error(selected.note)
  if (selected.activeId !== selected.configuredId) onFallback?.(selected.note)
  try {
    return await selected.provider.generateInterior(job)
  } catch (error) {
    if (selected.activeId === 'mock') throw error
    const other = selected.activeId === 'comfyui' ? geminiWeb : comfyui
    const otherId = selected.activeId === 'comfyui' ? 'gemini-web' : 'comfyui'
    if (selected.activeId !== 'comfyui' && selected.activeId !== 'gemini-web') throw error
    const health = await other.healthy().catch(() => ({ reachable: false }))
    if (!health.reachable)
      throw new Error(`${selected.activeId} failed: ${String(error?.message || error)}. ${otherId} is unavailable.`)
    onFallback?.(`${selected.activeId} failed; switching to ${otherId}`)
    return other.generateInterior(job)
  }
}

/** The Render page always tries this order. InteriorStudio retains its own policy. */
export async function generateBuildingWithFallback(job, registry = REGISTRY) {
  const attempts = []
  for (const activeId of geminiFirst() ? ['gemini-web','comfyui','mock'] : ['comfyui','gemini-web','mock']) {
    const provider = registry[activeId]
    try {
      const health = await provider.healthy()
      if (!health.reachable) throw new Error(health.note || 'offline')
      const result = await provider.generateBuilding(job)
      if (typeof result.imageBase64 !== 'string' || !result.imageBase64) throw new Error('No image returned')
      return {...result, provider:activeId, mock:activeId==='mock',
        meta:{...result.meta,provider:activeId,attempts}}
    } catch(error) {
      attempts.push({provider:activeId,reason:String(error?.message || error)})
    }
  }
  throw new Error('No building image or source preview available')
}

export async function buildingRenderHealth() {
  for (const provider of geminiFirst() ? [geminiWeb,comfyui] : [comfyui,geminiWeb]) {
    const health = await provider.healthy().catch(()=>({reachable:false}))
    if (health.reachable) return {ok:true,reachable:true,configured:true,mock:false,provider:provider.id,note:''}
  }
  return {ok:true,reachable:true,configured:false,mock:true,provider:'mock',
    note:'AI image providers are offline. Source previews remain available.'}
}
