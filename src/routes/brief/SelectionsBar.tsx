import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useState } from 'react'
import { useStudio } from '@/state/studio.ts'
import { CHARACTER_LABEL } from '@/lib/model/brief.ts'
import { briefRooms } from '@/lib/furniture/rooms.ts'
export function SelectionsBar({jump}:{jump:(step:number)=>void}){
  useLanguage(s => s.language);

 const brief=useStudio(s=>s.brief)
 const chips:[string,string,number][]=[['Plot',`${brief.site.plotWidth} × ${brief.site.plotDepth} m`,1],['People',String(brief.household.members.length),2],['Levels',String(brief.levels.storeys+1),3],['Rooms',String(briefRooms(brief).length),4],['Style',CHARACTER_LABEL[brief.style.character]??'not set',5],['Entry',brief.entry.primarySide==='auto'?'Auto':brief.entry.primarySide,6]]
 return <div className="border-t border-line bg-bg px-6 py-2 md:px-10"><div className="mx-auto max-w-[1320px]"><p className="label mb-2">{translateUi("Selections so far")}</p>
  <div className="flex gap-2 overflow-x-auto pb-1">{chips.map(([name,value,step])=><button key={name} type="button" onClick={()=>jump(step)} className="flex-none border border-line px-3 py-1 text-xs"><span className="text-ink-faint">{translateUi(name)}: </span>{translateUi(value||'not set')}</button>)}
  </div>
 </div></div>
}
