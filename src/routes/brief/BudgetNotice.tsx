import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useMemo } from 'react'
import { useStudio } from '@/state/studio.ts'
import { budgetVerdict, typicalBudgetBand } from '@/lib/cost/briefBudget.ts'
import { formatINRShort } from '@/lib/format.ts'
export function BudgetNotice(){
  useLanguage(s => s.language);

 const brief=useStudio(s=>s.brief),edit=useStudio(s=>s.edit),band=useMemo(()=>typicalBudgetBand(brief),[brief])
 return <div className="space-y-3 border-l-2 border-line-strong bg-bg-inset px-4 py-3 text-sm">
  <label className="block">{translateUi("Optional budget (₹ lakh)")}<input aria-label={translateUi("Budget in lakh")} type="number" min="0" step="1" value={brief.budget?brief.budget.amount/100000:''} placeholder={translateUi("Not set")} className="mt-1 w-full border border-line bg-bg p-2" onChange={e=>{const value=Number(e.target.value);edit(b=>{if(e.target.value&&Number.isFinite(value)&&value>0)b.budget={amount:value*100000};else delete b.budget})}} /></label>
  <p role="status" aria-live="polite">{translateUi(budgetVerdict(brief.budget?.amount,band))} {translateUi(" · Typical range ")}{translateUi(formatINRShort(band.low))}–{translateUi(formatINRShort(band.high))}</p>
  <p className="text-xs text-ink-dim">{translateUi("Programme area × ")}{translateUi(brief.finish)} {translateUi(" finish rate band. Concept estimate ±15% · approximate · ")}{translateUi(band.city)} {translateUi(" rates ")}{translateUi(band.date)}{translateUi(". Final measured cost follows your generated plan. Budget never removes rooms or changes the plan.")}</p>
 </div>
}
