/* Provider registry for AI interior generation. Add a backend by dropping
 * a sibling module exporting { id, healthy(), generateInterior(job) } and
 * listing it here. Selection: INTERIOR_PROVIDER env (comfyui | gemini |
 * mock), default comfyui, with an automatic fall-back to mock when the
 * chosen provider isn't reachable. */
import * as comfyui from './comfyui.mjs'
import * as gemini from './gemini.mjs'
import * as mock from './mock.mjs'

const REGISTRY = { comfyui, gemini, mock }

export function providerName() {
  const name = (process.env.INTERIOR_PROVIDER || 'comfyui').toLowerCase()
  return REGISTRY[name] ? name : 'comfyui'
}

/**
 * Resolve which provider to actually run.
 * @returns {{ id: string, reachable: boolean, note: string, provider: object, usingMock: boolean }}
 *   `id`/`reachable`/`note` describe the *configured* provider; `provider` is
 *   the module to call (mock when the configured one is down).
 */
export async function resolveProvider() {
  const name = providerName()
  const chosen = REGISTRY[name]
  const health = await chosen.healthy().catch(() => ({ reachable: false, note: 'health check threw' }))

  if (health.reachable || name === 'mock') {
    return { id: name, reachable: !!health.reachable, note: health.note || '', provider: chosen, usingMock: name === 'mock' }
  }
  return {
    id: name,
    reachable: false,
    note: `${name} unavailable — ${health.note || 'offline'}. Falling back to mock output.`,
    provider: mock,
    usingMock: true,
  }
}

export { mock }
