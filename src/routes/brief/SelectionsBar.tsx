import { useState } from 'react'
import { useStudio } from '@/state/studio.ts'
import { CHARACTER_LABEL } from '@/lib/model/brief.ts'
import { briefRooms } from '@/lib/furniture/rooms.ts'
import { budgetVerdict, typicalBudgetBand } from '@/lib/cost/briefBudget.ts'
import { formatINRShort } from '@/lib/format.ts'
import { BudgetNotice } from './BudgetNotice.tsx'
export function SelectionsBar({jump}:{jump:(step:number)=>void}){
 const brief=useStudio(s=>s.brief),[budgetOpen,setBudgetOpen]=useState(false),band=typicalBudgetBand(brief)
 const chips:[string,string,number][]=[['Plot',`${brief.site.plotWidth} × ${brief.site.plotDepth} m`,1],['People',String(brief.household.members.length),2],['Levels',String(brief.levels.storeys+1),3],['Rooms',String(briefRooms(brief).length),4],['Style',CHARACTER_LABEL[brief.style.character]??'not set',5],['Entry',brief.entry.primarySide==='auto'?'Auto':brief.entry.primarySide,6]]
 return <div className="border-t border-line bg-bg px-6 py-2 md:px-10"><div className="mx-auto max-w-[1320px]"><p className="label mb-2">Selections so far</p>
  <div className="flex gap-2 overflow-x-auto pb-1">{chips.map(([name,value,step])=><button key={name} type="button" onClick={()=>jump(step)} className="flex-none border border-line px-3 py-1 text-xs"><span className="text-ink-faint">{name}: </span>{value||'not set'}</button>)}
   <button type="button" aria-expanded={budgetOpen} onClick={()=>setBudgetOpen(v=>!v)} className="flex-none border border-line px-3 py-1 text-xs">Budget: {brief.budget?formatINRShort(brief.budget.amount):'not set'} · {budgetVerdict(brief.budget?.amount,band)}</button>
  </div>{budgetOpen&&<div className="mt-3 max-w-xl"><BudgetNotice /></div>}
 </div></div>
}
