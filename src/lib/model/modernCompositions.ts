// Keep the original ids for exact replay of saved projects.
export const MODERN_COMPOSITIONS = ['glazed-bay', 'staggered-wings', 'terraced-villa', 'offset-box', 'framed-balcony', 'stepped-terrace', 'interlocking-boxes'] as const
export type ModernComposition = (typeof MODERN_COMPOSITIONS)[number]
export const MODERN_DIRECTION_COMPOSITIONS = ['offset-box', 'framed-balcony', 'stepped-terrace', 'interlocking-boxes'] as const

export const MODERN_COMPOSITION_CHOICES: {value:ModernComposition;title:string;body:string}[] = [
  {value:'offset-box',title:'Offset Box',body:'Projecting upper room blocks over a recessed ground floor. Structural design requires review.'},
  {value:'framed-balcony',title:'Framed Balcony',body:'A deep rectangular roof frame shelters a recessed, accessible balcony.'},
  {value:'stepped-terrace',title:'Stepped Terrace',body:'Upper rooms retreat to form connected outdoor terraces.'},
  {value:'interlocking-boxes',title:'Interlocking Boxes',body:'Unequal rectangular wings share a continuous stair and circulation core.'},
  {value:'glazed-bay',title:'Glazed central bay',body:'A central stair bay, tall glazing and recessed room wings under deep canopies.'},
  {value:'staggered-wings',title:'Staggered wings',body:'Unequal upper wings, linked galleries and distinct roof levels.'},
  {value:'terraced-villa',title:'Terraced villa',body:'Upper rooms step back over connected garden terraces with open glass rails.'},
]
export const modernCompositionTitle=(value:ModernComposition)=>MODERN_COMPOSITION_CHOICES.find(c=>c.value===value)!.title
