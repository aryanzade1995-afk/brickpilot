import type { UtilityFloor } from '@/lib/utilities/plan.ts'
import { clusterDrainageNodes, drainageTrace, DRAINAGE_DISPLAY, DRAINAGE_NODE_NAMES } from '@/lib/utilities/drainagePresentation.ts'
import { DRAINAGE_COLORS } from '@/lib/utilities/drainageRules.ts'
import { translate as t } from '@/lib/i18n/index.ts'

const button = 'min-h-11 border border-line px-3 py-2 text-xs text-ink-dim hover:border-line-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-accent'
export function DrainageMapDetails({ model, selected, scale, select }: { model: UtilityFloor; selected: string | null; scale: number; select: (id: string | null) => void }) {
  const design = model.drainageDesign, pipe = design?.pipes.find(p => p.id === selected), node = design?.nodes.find(n => n.id === selected)
  if (!design || !pipe && !node) return null
  const trace = drainageTrace(design, selected), visibleNodes = design.nodes.filter(n => design.input.visible[n.service]), group = clusterDrainageNodes(visibleNodes, scale).find(g => g.nodes.some(n => n.id === selected))
  const components = group?.nodes ?? design.nodes.filter(n => n.id === pipe?.from || n.id === pipe?.to), roomId = pipe?.roomId ?? node?.roomId, service = pipe?.service ?? node!.service
  const reference = selected?.startsWith('trap:') ? selected.slice(5) : selected?.startsWith('CO:') ? selected.slice(3) : selected
  const checks = design.checks.filter(c => c.itemId === selected || c.itemId === reference || pipe?.fixtureIds.includes(c.itemId)), title = pipe ? DRAINAGE_DISPLAY[pipe.service].label : DRAINAGE_NODE_NAMES[node!.kind]
  const componentName = (n: typeof components[number]) => {
    const fixture = n.kind === 'trap' ? design.fixtures.find(f => n.id === `trap:${f.id}`) : null
    return fixture ? `${fixture.kind.replaceAll('_', ' ')} · ${t('Trap')}` : t(DRAINAGE_NODE_NAMES[n.kind])
  }
  return <section aria-label={t('Drainage selection details')} className="border-t border-line bg-bg-raised p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[9px] uppercase tracking-widest text-ink-faint">{t('Selected connection')}</p><h3 className="mt-1 font-display text-xl" style={{ color: DRAINAGE_COLORS[service] }}>{t(title)}</h3><p className="mt-1 text-xs text-ink-dim">{t(model.floor.rooms.find(r => r.id === roomId)?.name ?? 'Whole home')} · {trace.pipes.size} {t('connected segments')}</p></div><button className={button} onClick={() => select(null)}>{t('Clear selection')}</button></div>
    {pipe && <dl className="mt-4 grid grid-cols-2 gap-4 border-y border-line py-3 text-xs sm:grid-cols-4">{[
      ['Diameter', pipe.diameterMm === null ? 'Not specified' : `${pipe.diameterMm} mm`], ['Gradient', pipe.gradientRatio ? `1:${pipe.gradientRatio}` : 'Not verified'],
      ['Invert levels', pipe.inletInvertMm === null || pipe.outletInvertMm === null ? 'Not verified' : `${pipe.inletInvertMm} → ${pipe.outletInvertMm} mm`], ['Layout status', pipe.state === 'blocked' ? 'Needs review' : 'Proposed'],
    ].map(([key, value]) => <div key={key}><dt className="text-ink-faint">{t(key)}</dt><dd className="mt-1 font-medium">{t(value)}</dd></div>)}</dl>}
    {components.length > 0 && <div className="mt-4"><p className="mb-2 text-xs text-ink-dim">{t(group && group.nodes.length > 1 ? 'Components grouped at this zoom' : 'Connection components')}</p><div className="flex flex-wrap gap-2">{components.map(n => <button key={n.id} className={`${button} ${selected === n.id ? 'border-line-strong bg-bg-inset' : ''}`} aria-pressed={selected === n.id} onClick={() => select(n.id)}>{componentName(n)}</button>)}</div></div>}
    {node && trace.pipes.size > 0 && <div className="mt-4"><p className="mb-2 text-xs text-ink-dim">{t('Connected pipes')}</p><div className="flex flex-wrap gap-2">{design.pipes.filter(p => trace.pipes.has(p.id)).map(p => <button key={p.id} className={button} onClick={() => select(p.id)}>{t(DRAINAGE_DISPLAY[p.service].label)} · {p.diameterMm ?? t('Not specified')}</button>)}</div></div>}
    {node && <p className="mt-3 text-xs text-ink-dim">{t('Plan position')}: {node.position.x}, {node.position.y} mm · {t('Elevation')}: {node.elevationMm === null ? t('Not verified') : `${node.elevationMm} mm`}</p>}
    <p className="mt-3 break-all font-mono text-[9px] text-ink-faint">{selected}</p>
    {checks.length > 0 && <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 text-xs">{t('Review findings')} · {checks.filter(c => c.status !== 'Pass').length}</summary><div className="max-h-72 space-y-3 overflow-auto text-xs">{checks.map(c => <div key={c.id} className="border-l-2 border-line pl-3"><p className="font-medium">{t(c.status)} · {t(c.category)}</p><p className="mt-1 text-ink-dim">{c.reason}</p><p className="mt-1 text-ink-dim">{c.correction}</p></div>)}</div></details>}
  </section>
}
