import type { Brief } from '../model/brief.ts'
import { compile } from '../model/canonical.ts'
import { rateBook } from './catalogue.ts'
export type BudgetBand = { low:number; high:number; area:number; city:string; date:string }
export function typicalBudgetBand(brief:Brief):BudgetBand {
 const area=compile(brief).floors.flatMap(f=>f.spaces).filter(s=>!s.outdoor).reduce((n,s)=>n+s.target,0)
 const rate=rateBook.sanityBands[brief.finish],settings=rateBook.settings
 return {low:area*settings.sqftPerSqm*rate.min,high:area*settings.sqftPerSqm*rate.max,area,city:settings.city,date:settings.date}
}
export function budgetVerdict(amount:number|undefined,band:Pick<BudgetBand,'low'|'high'>):'Not set'|'Within budget'|'Tight'|'Over budget' {
 return amount===undefined?'Not set':amount>=band.high?'Within budget':amount>=band.low?'Tight':'Over budget'
}
