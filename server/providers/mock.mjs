/* Mock interior provider — no models, no ComfyUI. Ramps a fake progress
 * bar then echoes the 3D beauty render so the whole flow is demoable. */

export const id = 'mock'

export async function healthy() {
  return { reachable: true, note: 'mock provider — echoes the 3D render (install ComfyUI for real output)' }
}

export async function generateInterior({ beauty, onProgress }) {
  const stages = [
    [10, 'loading checkpoint'],
    [22, 'encoding prompt'],
    [34, 'applying ControlNet (depth)'],
    [44, 'applying ControlNet (edge)'],
    [56, 'sampling'],
    [70, 'sampling'],
    [84, 'sampling'],
    [94, 'VAE decode'],
  ]
  for (const [pct, stage] of stages) {
    await new Promise((r) => setTimeout(r, 320))
    onProgress?.(pct, stage)
  }
  return {
    imageBase64: beauty,
    mimeType: 'image/png',
    meta: { provider: 'mock', seed: Math.floor(Math.random() * 1e9) },
  }
}
