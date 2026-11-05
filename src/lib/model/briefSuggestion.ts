import type {Brief} from './brief.ts'

/** A cached suggestion changes its own fields, preserving newer cosmetic edits. */
export function applySuggestionChanges(current:Brief,source:Brief,target:Brief):void{
 const apply=(to:Record<string,unknown>,before:Record<string,unknown>,after:Record<string,unknown>)=>{
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
   const a=before[key],b=after[key]
   if(JSON.stringify(a)===JSON.stringify(b))continue
   if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b))
    apply(to[key] as Record<string,unknown>,a as Record<string,unknown>,b as Record<string,unknown>)
   else if(b===undefined)delete to[key]
   else to[key]=structuredClone(b)
  }
 }
 apply(current as unknown as Record<string,unknown>,source as unknown as Record<string,unknown>,target as unknown as Record<string,unknown>)
}
