import { useEffect, type ReactNode } from 'react'
import { useLanguage } from '@/lib/i18n/index.ts'

export function LanguageDocument({ children }: { children: ReactNode }) {
  const language = useLanguage(s => s.language)
  useEffect(() => { document.documentElement.lang = language }, [language])
  return children
}
