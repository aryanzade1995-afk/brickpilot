export const button='inline-flex min-h-11 items-center justify-center gap-2 rounded border border-line px-4 text-sm transition-colors hover:bg-bg-inset focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50'
export const field='min-h-11 w-full rounded border border-line bg-bg-raised px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent'
export const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n)
export const number=(n:number)=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:1}).format(n)

export const IMPACT_VIEWS=[
 {id:'overview',label:'Overview'}, {id:'affordability',label:'Cost & materials'},
 {id:'water',label:'Water'}, {id:'climate',label:'Climate & solar'},
 {id:'accessibility',label:'Access & safety'}, {id:'community',label:'Community'},
 {id:'guidance',label:'Guidance'}, {id:'standards',label:'Sources & assumptions'},
 {id:'all',label:'Project report'},
] as const
export type ImpactView=typeof IMPACT_VIEWS[number]['id']
