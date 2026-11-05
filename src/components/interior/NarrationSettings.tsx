import {useNarrationPreferences} from '@/state/narrationPreferences.ts'
import type {GuideLanguage} from '@/lib/walkthrough/guide.ts'
import {translate as t} from '@/lib/i18n/index.ts'

export function NarrationSettings(){
 const {language,enabled,setLanguage,setEnabled}=useNarrationPreferences()
 return <div className="my-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-dim">
  <label className="flex min-h-11 items-center gap-2">{t('Narration language')}<select aria-label="Narration language before walkthrough" className="min-h-11 border border-line bg-bg px-3 text-ink" value={language} onChange={e=>setLanguage(e.target.value as GuideLanguage)}><option value="mr">मराठी</option><option value="hi">हिन्दी</option><option value="en">English</option></select></label>
  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} className="accent-accent"/>{t('Room narration')}</label>
  <span>{t('Esc releases the mouse and returns to these controls.')}</span>
 </div>
}
