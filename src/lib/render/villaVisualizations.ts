export const VILLA_VIEW_LABELS={'front':'Front view'} as const
export type VillaView=keyof typeof VILLA_VIEW_LABELS
/** depth: the model's true depth from the same camera (near is white), so the AI is held to the real geometry */
export type VillaReferenceView={view:VillaView;beauty:string;edge:string;depth?:string}
export type VillaVisualizationImage={view:VillaView;url:string}
export type VillaVisualizationPair={sourceId:string;images:VillaVisualizationImage[]}
export function visualizationSourceId(planId:string,source:'blender',seed:number,artifact='',finish='') {
  return `${planId}|${source}|${seed}|${artifact}|${finish}`
}
export function readVisualizationPair(data:unknown,sourceId:string):VillaVisualizationPair {
  const value=data as Partial<VillaVisualizationPair>|null
  if(value?.sourceId!==sourceId||!Array.isArray(value.images)||value.images.length!==Object.keys(VILLA_VIEW_LABELS).length)throw new Error('The model changed. Please generate again.')
  const images=(Object.keys(VILLA_VIEW_LABELS) as VillaView[]).map(view=>{
    const choices=value.images!.filter(image=>image.view===view)
    if(choices.length!==1||typeof choices[0].url!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(choices[0].url))throw new Error('Visualizations are unavailable right now. Your 3D model is ready.')
    return choices[0]
  })
  return {sourceId,images}
}
