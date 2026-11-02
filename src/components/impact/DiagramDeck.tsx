import {useId,useState} from 'react'
import type {ReactNode} from 'react'
import {Layers3} from 'lucide-react'
import {translate as t} from '@/lib/i18n/index.ts'

export type DiagramChoice={id:string;label:string;note:string;content:ReactNode}

/** Keep every diagram available without making users scroll past every chart. */
export function DiagramDeck({choices}:{choices:DiagramChoice[]}){
 const [selected,setSelected]=useState(choices[0]?.id)
 const active=choices.find(choice=>choice.id===selected)??choices[0]
 const id=useId()
 if(!active)return null
 return <section className="impact-diagram-deck min-w-0" aria-label={t('Visual analysis')}>
  <header className="mb-3 border-b border-line pb-3">
   <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint"><Layers3 size={13} strokeWidth={1.5} aria-hidden/>{t('Visual analysis')}</div>
   <div role="group" aria-label={t('Choose a diagram')} className="flex flex-wrap gap-1.5">
    {choices.map((choice,i)=><button key={choice.id} type="button" aria-pressed={choice.id===active.id} aria-controls={id} onClick={()=>setSelected(choice.id)} className={`inline-flex min-h-11 items-center gap-2 rounded border px-3 text-xs focus-visible:outline-2 focus-visible:outline-accent ${choice.id===active.id?'border-ink bg-ink text-bg':'border-line bg-bg-raised text-ink-dim hover:border-line-strong hover:bg-bg-inset'}`}><span className={`font-mono text-[9px] ${choice.id===active.id?'text-bg/60':'text-ink-faint'}`}>{String(i+1).padStart(2,'0')}</span>{t(choice.label)}</button>)}
   </div>
  </header>
  <div id={id} role="region" aria-label={t(active.label)} className="min-w-0">
   <p className="mb-3 max-w-2xl text-xs leading-relaxed text-ink-faint">{t(active.note)}</p>
   <div key={active.id} className="impact-visuals min-w-0 space-y-3">{active.content}</div>
  </div>
 </section>
}
