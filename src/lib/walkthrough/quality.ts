export const WALKTHROUGH_QUALITY = {
  adaptive: { label: 'Balanced · adaptive', min: .75, max: 1.5, start: 1.25 },
  detailed: { label: 'Detailed · adaptive', min: .75, max: 1.75, start: 1.5 },
  performance: { label: 'Performance · adaptive', min: .65, max: 1, start: 1 },
} as const
export type WalkthroughQuality = keyof typeof WALKTHROUGH_QUALITY

export function gpuLabel(renderer: string) {
  if (/nvidia/i.test(renderer)) return renderer.match(/NVIDIA\s+(?:GeForce|RTX|Quadro)[^,()]*/i)?.[0].trim() ?? 'NVIDIA GPU'
  if (/intel/i.test(renderer)) return 'Intel integrated graphics'
  if (/amd|radeon/i.test(renderer)) return 'AMD graphics'
  if (/swiftshader|software|llvmpipe/i.test(renderer)) return 'Software graphics'
  return 'Browser graphics'
}
