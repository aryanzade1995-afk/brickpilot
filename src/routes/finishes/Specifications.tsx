import { useState } from 'react'
import { FinishSwatch } from './FinishSwatch.tsx'
import type { Brief } from '@/lib/model/brief.ts'
import type { Design } from '@/lib/engine/types.ts'
import type { CostEstimate } from '@/lib/cost/index.ts'
import { specsCatalogue } from '@/lib/cost/catalogue.ts'
import { applicableRooms, applySpecification, changeCount, effectiveSpec, itemChanged, itemLines, quantityLabel, suggestionFor, undoSpecification, type SpecItem } from '@/lib/cost/workspace.ts'
import { SpecificationPanel } from './SpecificationPanel.tsx'
import { paintColour } from '@/lib/finishes/paint.ts'
import { cx } from '@/lib/cx.ts'
import { photographedOptions, representativeOption } from '@/lib/finishes/optionImage.ts'

/** not part of the Finishes section: their allowances stay in the estimate at their defaults */
const HIDDEN_GROUPS = new Set(['external-works', 'extras', 'fees-contract'])
/** the card's mini photograph: the chosen product itself, or for a general allowance the pictured product nearest its price */
export function Specifications({ brief, cost, design, room, onRoom, onBrief }: { brief: Brief; cost: CostEstimate; design: Design; room?: string; onRoom: (id: string) => void; onBrief: (brief: Brief) => void }) {
  const [group, setGroup] = useState('flooring'), [technical, setTechnical] = useState(false)
  const [more, setMore] = useState<Record<string, boolean>>({}), [editing, setEditing] = useState<SpecItem | null>(null)
  const [pendingFinish, setPending] = useState<Brief['finish'] | null>(null)
  const groups = [...new Set(specsCatalogue.items.filter(i => i.level !== 'auto' && i.level !== 'technical' && !HIDDEN_GROUPS.has(i.group)).map(i => i.group))]
  const groupLabel = (id: string) => id === 'technical' ? 'Technical' : specsCatalogue.groups.find(g => g.id === id)?.label ?? id
  const roomObject = cost.quantities.rooms.find(r => r.id === room)
  const eligible = (i: SpecItem) => !HIDDEN_GROUPS.has(i.group) && photographedOptions(i).length > 0 && (!room || i.scope === 'house' || applicableRooms(cost, i).some(r => r.id === room))
  const hasMain = specsCatalogue.items.some(i => i.group === group && i.level === 'main' && eligible(i))
  const visible = specsCatalogue.items.filter(i => i.level !== 'auto' && eligible(i) && (group === 'technical' ? i.level === 'technical' : i.group === group && (i.level === 'main' || (!hasMain || more[group]) && i.level === 'more')))
  const changedGroup = (g: string) => specsCatalogue.items.some(i => (g === 'technical' ? i.level === 'technical' : i.group === g && i.level !== 'technical') && itemChanged(brief, cost, i, room))
  const nav = (g: string) => <button key={g} type="button" onClick={() => setGroup(g)} aria-pressed={group === g} className={cx('flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm capitalize', group === g ? 'bg-bg-inset text-ink' : 'text-ink-dim hover:bg-bg-inset')}><span className="w-2 text-xs" aria-label={changedGroup(g) ? 'Changed section' : undefined}>{changedGroup(g) ? '●' : ''}</span>{groupLabel(g)}</button>
  return <>
    <div className="flex flex-wrap items-end gap-5 border-b border-line pb-5"><label className="text-xs">Finish level<select aria-label="Finish level" value={brief.finish} onChange={e => setPending(e.target.value as Brief['finish'])} className="mt-2 block min-w-36 border border-line bg-bg px-3 py-2.5 text-sm"><option value="basic">Basic</option><option value="mid">Mid</option><option value="premium">Premium</option></select></label>
      <p className="pb-2 text-xs text-ink-dim">{changeCount(brief)} {changeCount(brief) === 1 ? 'change' : 'changes'}</p><button type="button" onClick={() => onBrief({ ...brief, specs: { overrides: {} } })} className="pb-2 text-xs underline">Reset</button>
      <label className="ml-auto max-w-full text-xs">Room<select aria-label="Filter specifications by room" value={room ?? ''} onChange={e => onRoom(e.target.value)} className="mt-2 block w-full max-w-72 border border-line bg-bg px-3 py-2.5 text-sm"><option value="">Whole home</option>{cost.quantities.rooms.map(r => <option key={r.id} value={r.id}>{r.floor} · {r.name}</option>)}</select></label>
    </div>
    {pendingFinish && <div className="mt-4 flex flex-wrap items-center gap-3 bg-bg-inset p-4 text-sm" role="group" aria-label="Confirm finish level"><p className="flex-1">Use {pendingFinish === 'mid' ? 'Mid' : pendingFinish === 'basic' ? 'Basic' : 'Premium'} defaults? This replaces your finish changes.</p><button type="button" onClick={() => setPending(null)} className="px-3 py-2 underline">Keep current</button><button type="button" onClick={() => { onBrief({ ...brief, finish: pendingFinish, specs: { overrides: {} } }); setPending(null) }} className="bg-accent px-4 py-2 text-white">Use defaults</button></div>}
    <div className="mt-6 grid items-start gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Specification sections" className="min-w-0 border-b border-line pb-4 md:sticky md:top-6 md:max-h-[75vh] md:overflow-y-auto md:border-b-0 md:border-r md:pr-4"><div className="md:hidden"><label className="label">Section<select value={group} onChange={e => setGroup(e.target.value)} aria-label="Specification section" className="mt-2 w-full border border-line bg-bg p-3 text-sm normal-case tracking-normal">{groups.map(g => <option key={g} value={g}>{groupLabel(g)}{changedGroup(g) ? ' · changed' : ''}</option>)}<option value="technical">Technical</option></select></label></div>
        <div className="hidden md:block">{groups.map(nav)}<button type="button" onClick={() => setTechnical(!technical)} aria-expanded={technical} className="mt-4 w-full border-t border-line px-3 pt-4 text-left text-sm">Technical {technical ? '−' : '+'}{changedGroup('technical') ? ' ●' : ''}</button>{technical && <div className="mt-2">{nav('technical')}</div>}</div>
      </nav>
      <section className="min-w-0"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-2xl capitalize">{groupLabel(group)}</h2><span className="rounded-full border border-line px-3 py-1 text-xs text-ink-dim">{visible.length} specifications · {visible.reduce((n, i) => n + photographedOptions(i).length, 0)} choices</span></div><p className="mt-2 text-sm text-ink-dim">Explore finishes and specifications for this section. Your quantities stay linked to the plan.</p>{roomObject && <p className="mt-2 text-xs text-ink-dim">{roomObject.floor} · {roomObject.name}. Whole-home choices also apply here.</p>}
        {group === 'technical' && <p className="mt-2 text-xs leading-relaxed text-ink-dim">Concept allowances only. Approximate; structural design by a licensed engineer required.</p>}
        <div className="mt-5 grid gap-4 lg:grid-cols-2">{visible.map(item => {
          const rooms = applicableRooms(cost, item), scoped = room ? rooms.filter(r => r.id === room) : rooms
          const options = scoped.map(r => effectiveSpec(brief, item.id, r.id)), option = options[0] ?? effectiveSpec(brief, item.id)
          const mixed = options.some(o => o.id !== option.id)
          const changed = itemChanged(brief, cost, item, room), suggestion = suggestionFor(brief, item.id)
          const suggestedAlready = (scoped.length ? scoped.every(r => effectiveSpec(brief, item.id, r.id).id === suggestion?.option) : option.id === suggestion?.option)
          return <article key={item.id} className="rounded-xl border border-line bg-bg p-4 sm:p-5"><div className="flex items-start gap-3 sm:gap-4">
            <FinishSwatch item={item} option={representativeOption(item, option)} className="h-20 w-20 flex-none rounded-lg object-cover" />
            <div className="min-w-0 flex-1"><h3 className="text-sm">{item.label}</h3><p className="mt-1 text-xs text-ink-faint">{item.scope === 'house' ? 'Whole home' : scoped.length ? scoped.map(r => r.name).join(', ') : 'As applicable'}</p><p className="mt-2 text-sm text-ink-dim">{mixed ? 'Mixed room choices' : option.name}</p>{item.id === 'interior-paint' && <p className="mt-2 flex items-center gap-2 text-xs text-ink-dim"><span className="h-4 w-4 rounded border border-line" style={{ background: paintColour(brief, room ?? scoped[0]?.id).hex }} />{paintColour(brief, room ?? scoped[0]?.id).label}</p>}<p className="mt-1 text-xs text-ink-faint">{quantityLabel(itemLines(cost, item, room))}{item.id.startsWith('floor-') ? ' · flooring and skirting where measured' : ''}</p>
              {changed && <p className="mt-2 text-xs">Changed <button type="button" onClick={() => onBrief(undoSpecification(brief, cost, item, room))} className="ml-2 text-ink-dim underline">Undo</button></p>}</div>
            <button type="button" onClick={() => setEditing(item)} className="flex-none rounded-lg border border-line px-3 py-2 text-xs hover:bg-bg-inset">Change<span className="sr-only"> {item.label}</span></button>
          </div>{suggestion && !suggestedAlready && <p className="mt-3 bg-bg-inset px-3 py-2 text-xs leading-relaxed text-ink-dim">{suggestion.reason} <button type="button" onClick={() => onBrief(applySpecification(brief, cost, item, suggestion.option, scoped.map(r => r.id)))} className="ml-1 underline">Apply</button></p>}</article>
        })}</div>
        {!visible.length && <p className="py-6 text-sm text-ink-dim">No main choices in this section{room ? ' for this room' : ''}. Other choices are under More options.</p>}
        {group !== 'technical' && hasMain && specsCatalogue.items.some(i => i.group === group && i.level === 'more' && eligible(i)) && <button type="button" aria-expanded={!!more[group]} onClick={() => setMore({ ...more, [group]: !more[group] })} className="mt-4 border-t border-line pt-4 text-xs underline">{more[group] ? 'Fewer options' : 'More options'}</button>}
      </section></div>
    {editing && <SpecificationPanel key={editing.id} item={editing} brief={brief} cost={cost} design={design} room={room} onClose={() => setEditing(null)} onUse={next => { onBrief(next); setEditing(null) }} />}
  </>
}
