/* Gemini Web is the primary interior engine; ComfyUI preserves the rendered
 * room edges when Gemini Web is unavailable or its generation fails. */
import * as comfyui from './comfyui.mjs'
import * as geminiWeb from './gemini-web.mjs'
import * as gemini from './gemini.mjs'
import * as mock from './mock.mjs'

const REGISTRY = { 'gemini-web': geminiWeb, comfyui, gemini, mock }

export function providerName() {
  const name = (process.env.INTERIOR_PROVIDER || 'gemini-web').toLowerCase()
  return REGISTRY[name] ? name : 'gemini-web'
}

export async function resolveProvider() {
  const configuredId = providerName()
  const chosen = REGISTRY[configuredId]
  const health = await chosen.healthy().catch(() => ({ reachable: false, note: 'health check failed' }))
  if (health.reachable || configuredId === 'mock')
    return { configuredId, activeId: configuredId, reachable: !!health.reachable,
      note: health.note || '', provider: chosen, usingMock: configuredId === 'mock' }

  if (configuredId !== 'comfyui') {
    const fallback = await comfyui.healthy().catch(() => ({ reachable: false, note: 'health check failed' }))
    if (fallback.reachable)
      return { configuredId, activeId: 'comfyui', reachable: true,
        note: `${configuredId} unavailable (${health.note || 'offline'}); using ComfyUI`,
        provider: comfyui, usingMock: false }
  }
  return { configuredId, activeId: 'unavailable', reachable: false,
    note: `${configuredId} unavailable (${health.note || 'offline'}); ComfyUI also unavailable.`,
    provider: null, usingMock: false }
}

export async function generateInteriorWithFallback(job, onFallback) {
  const selected = await resolveProvider()
  if (!selected.reachable || !selected.provider) throw new Error(selected.note)
  if (selected.activeId !== selected.configuredId) onFallback?.(selected.note)
  try {
    return await selected.provider.generateInterior(job)
  } catch (error) {
    if (selected.activeId === 'comfyui' || selected.activeId === 'mock') throw error
    const health = await comfyui.healthy().catch(() => ({ reachable: false }))
    if (!health.reachable)
      throw new Error(`${selected.activeId} failed: ${String(error?.message || error)}. ComfyUI is unavailable.`)
    onFallback?.(`${selected.activeId} failed; switching to ComfyUI`)
    return comfyui.generateInterior(job)
  }
}

/** The Render page always tries this order. InteriorStudio retains its own policy. */
export async function generateBuildingWithFallback(job, registry = REGISTRY) {
  const attempts = []
  for (const activeId of ['gemini-web','comfyui','mock']) {
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
  for (const provider of [geminiWeb,comfyui]) {
    const health = await provider.healthy().catch(()=>({reachable:false}))
    if (health.reachable) return {ok:true,reachable:true,configured:true,mock:false,provider:provider.id,note:''}
  }
  return {ok:true,reachable:true,configured:false,mock:true,provider:'mock',
    note:'AI image providers are offline. Source previews remain available.'}
}
