import { LANGUAGES, useLanguage } from '@/lib/i18n/index.ts'

export function LanguageSelector() {
  const { language, setLanguage } = useLanguage()
  return <label className="flex shrink-0 items-center gap-1.5 text-xs" translate="no">
    <span className="sr-only">Language / भाषा</span>
    <select aria-label="Language / भाषा" value={language} onChange={event => setLanguage(event.target.value as typeof language)}
      className="max-w-24 border border-line bg-bg px-2 py-2 text-sm focus:border-ink">
      {LANGUAGES.map(item => <option key={item.code} value={item.code} lang={item.code}>{item.label}</option>)}
    </select>
  </label>
}
