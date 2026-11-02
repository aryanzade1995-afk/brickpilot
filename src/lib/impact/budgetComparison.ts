export type BudgetComparisonInput={budget:number|null;currentCost:number;swappedCost:number}
const amount=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null

/** Missing targets remain missing. All deltas come from the two estimates. */
export function budgetComparison(input:BudgetComparisonInput){
 const target=amount(input.budget),current=amount(input.currentCost),proposed=amount(input.swappedCost)
 const invalidTarget=input.budget!==null&&target===null
 const difference=current!==null&&proposed!==null?current-proposed:null
 const percent=difference===null||current===null?null:current>0?difference/current*100:difference===0?0:null
 const remaining=target!==null&&proposed!==null?target-proposed:null
 const currentRemaining=target!==null&&current!==null?target-current:null
 const status=invalidTarget?'invalid':target===null?'missing':remaining===null?'incomplete':remaining<0?'over':remaining>0?'within':'on-target'
 const maximum=Math.max(target??0,current??0,proposed??0)
 return {target,current,proposed,difference,percent,remaining,currentRemaining,status,maximum,ready:current!==null&&proposed!==null} as const
}
