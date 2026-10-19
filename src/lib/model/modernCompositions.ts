export const MODERN_COMPOSITIONS = ['glazed-bay', 'staggered-wings', 'terraced-villa'] as const
export type ModernComposition = (typeof MODERN_COMPOSITIONS)[number]

export const MODERN_COMPOSITION_CHOICES: {value:ModernComposition;title:string;body:string}[] = [
  {value:'glazed-bay',title:'Glazed central bay',body:'A central stair bay, tall glazing and recessed room wings under deep canopies.'},
  {value:'staggered-wings',title:'Staggered wings',body:'Unequal upper wings, linked galleries and distinct roof levels.'},
  {value:'terraced-villa',title:'Terraced villa',body:'Upper rooms step back over connected garden terraces with open glass rails.'},
]
export const modernCompositionTitle=(value:ModernComposition)=>MODERN_COMPOSITION_CHOICES.find(c=>c.value===value)!.title
