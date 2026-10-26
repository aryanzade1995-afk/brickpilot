export const WALKTHROUGH_QUALITY = {
  adaptive: { label: 'Balanced', min: .75, max: 1, start: 1, target:60 },
  detailed: { label: 'High Quality', min: .85, max: 1.25, start: 1, target:60 },
  performance: { label: 'Performance', min: .65, max: 1, start: .85, target:60 },
} as const
export type WalkthroughQuality = keyof typeof WALKTHROUGH_QUALITY

export function adaptWalkthroughResolution(quality:WalkthroughQuality,fps:number,ratio:number,good:number){
 const budget=WALKTHROUGH_QUALITY[quality]
 if(fps<55)return {ratio:Math.max(budget.min,ratio-.1),good:0}
 if(fps>59)return good>=3?{ratio:Math.min(budget.max,ratio+.05),good:0}:{ratio,good:good+1}
 return {ratio,good:0}
}

export function gpuLabel(renderer: string) {
  if (/nvidia/i.test(renderer)) return renderer.match(/NVIDIA\s+(?:GeForce|RTX|Quadro)[^,()]*/i)?.[0].trim() ?? 'NVIDIA GPU'
  if (/intel/i.test(renderer)) return 'Intel integrated graphics'
  if (/amd|radeon/i.test(renderer)) return 'AMD graphics'
  if (/swiftshader|software|llvmpipe/i.test(renderer)) return 'Software graphics'
  return 'Browser graphics'
}
