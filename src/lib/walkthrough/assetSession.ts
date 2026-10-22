/** Delivery references only. Finish choices stay exclusively in the Brief.
 * This lets returning from Finishes & Cost reuse a previously exported shell. */
export type WalkthroughSession = { id: string; designId: string; projectId: string; geometryKey: string; appearanceKey: string; status: 'ready'; signature: string }
const memory = new Map<string, WalkthroughSession>()
const key = (project: string, geometry: string) => `formstead.walkthrough.delivery:${JSON.stringify([project, geometry])}`
export function readWalkthroughSession(project: string, geometry: string): WalkthroughSession | null {
  const k = key(project, geometry)
  try {
    const value = memory.get(k) ?? JSON.parse(sessionStorage.getItem(k) ?? 'null')
    return value?.projectId === project && /^[a-f0-9]{64}$/.test(value.id) && value.status === 'ready' && typeof value.signature === 'string' ? value : null
  } catch { return memory.get(k) ?? null }
}
export function saveWalkthroughSession(project: string, geometry: string, value: WalkthroughSession) {
  const k = key(project, geometry); memory.set(k, value)
  try { sessionStorage.setItem(k, JSON.stringify(value)) } catch { /* Private/storage-disabled sessions still work in memory. */ }
}
