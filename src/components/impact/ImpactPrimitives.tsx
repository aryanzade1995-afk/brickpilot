import type {ReactNode} from 'react'
import {Link} from 'react-router-dom'
import {ArrowUpRight,ChevronDown} from 'lucide-react'
import {translate as t} from '@/lib/i18n/index.ts'

import {button,field} from './presentation.ts'

export function Card({title,children}:{title:string;children:ReactNode}){
 return <article className="impact-card min-w-0 rounded border border-line bg-bg-raised p-4"><h3 className="border-b border-line pb-3 font-display text-base text-ink">{t(title)}</h3><div className="mt-3 space-y-3 text-xs leading-relaxed text-ink-dim">{children}</div></article>
}
export function Metric({label,value,note}:{label:string;value:string;note?:string}){
 return <div className="min-w-0 rounded border border-line bg-bg-raised p-4"><p className="text-[11px] text-ink-dim">{t(label)}</p><p className="mt-1 break-words font-display text-2xl tabular-nums text-ink">{t(value)}</p>{note&&<p className="mt-1 text-[10px] leading-relaxed text-ink-faint">{t(note)}</p>}</div>
}
export function Action({to,children}:{to:string;children:ReactNode}){
 return <Link className={`${button} w-fit text-ink`} to={to}>{typeof children==='string'?t(children):children}<ArrowUpRight size={14} aria-hidden/></Link>
}
export function Details({title='Details',children,id}:{title?:string;children:ReactNode;id?:string}){
 return <details id={id} className="group min-w-0 rounded border border-line bg-bg-raised px-4"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 text-xs text-ink focus-visible:outline-2 focus-visible:outline-accent">{t(title)}<ChevronDown size={13} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden/></summary><div className="space-y-3 border-t border-line py-3 text-xs text-ink-dim">{children}</div></details>
}
export function Numeric({label,value,change,max=1e12,min=0}:{label:string;value:number|null;change:(v:number|null)=>void;max?:number;min?:number}){
 return <label className="block text-xs text-ink-dim">{t(label)}<input key={`${label}:${value}`} className={`${field} mt-2`} type="number" step="any" min={min} max={max} defaultValue={value??''} placeholder={t('Not recorded')} onBlur={e=>{const raw=e.currentTarget.value,n=Number(raw);if(raw==='')change(null);else if(Number.isFinite(n)&&n>=min&&n<=max)change(n);else e.currentTarget.value=String(value??'')}}/></label>
}
export function TextField({label,value,change}:{label:string;value:string;change:(v:string)=>void}){
 return <label className="block text-xs text-ink-dim">{t(label)}<input key={`${label}:${value}`} className={`${field} mt-2`} maxLength={1000} defaultValue={value} onBlur={e=>change(e.currentTarget.value)}/></label>
}
