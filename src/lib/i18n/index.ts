import { create } from 'zustand'
import { messages } from './messages.ts'
import { extraMessages } from './extraMessages.ts'
import {plumbingMessages} from './plumbingMessages.ts'
import { solarMessages } from './solarMessages.ts'
import { utilityMessages } from './utilityMessages.ts'
import { walkthroughMessages } from './walkthroughMessages.ts'

export type Language = 'en' | 'hi' | 'mr'
export const LANGUAGES = [{ code: 'en', label: 'English' }, { code: 'hi', label: 'हिन्दी' }, { code: 'mr', label: 'मराठी' }] as const
const storageKey = 'formstead.language'
const storedLanguage = (): Language => {
  try { const saved = localStorage.getItem(storageKey); if (saved === 'hi' || saved === 'mr') return saved } catch { /* Storage may be unavailable. */ }
  return 'en'
}
export const useLanguage = create<{ language: Language; setLanguage: (language: Language) => void }>(set => ({
  language: storedLanguage(),
  setLanguage: language => {
    if (!LANGUAGES.some(item => item.code === language)) return
    try { localStorage.setItem(storageKey, language) } catch { /* The language still works for this visit. */ }
    set({ language })
  },
}))

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
const entries = Object.entries({ ...messages, ...extraMessages,...plumbingMessages, ...solarMessages, ...utilityMessages, ...walkthroughMessages })
const lookup = new Map(entries.map(([key, translations]) => [normalize(key).toLowerCase(), translations]))
const patterns = entries.filter(([key]) => /\{\d+\}/.test(key)).sort(([a], [b]) => b.length - a.length).map(([key, translations]) => ({
  regex: new RegExp('^' + key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)') + '$', 'i'), translations,
}))

/** Translate presentation strings only; numbers, React elements, stored form
 * values, geometry identifiers and exports retain their original types/data. */
export function translate<T>(value: T, language: Language = useLanguage.getState().language): T {
  if (typeof value !== 'string' || language === 'en' || !value.trim()) return value
  const text = normalize(value), column = language === 'hi' ? 0 : 1
  let translated = lookup.get(text.toLowerCase())?.[column]
  if (!translated) for (const pattern of patterns) {
    const match = pattern.regex.exec(text)
    if (match) { translated = pattern.translations[column].replace(/\{(\d+)\}/g, (_, index) => translate(match[Number(index) + 1], language)); break }
  }
  if (!translated) {
    // Independently labelled chips, unit captions and sentence fragments.
    const parts = text.split(/(\s*[,·•]\s*|\s*→\s*|\s*:\s*)/)
    if (parts.length > 1) translated = parts.map((part, index) => index % 2 ? part : translate(part, language)).join('')
  }
  if (!translated || translated === text) return value
  const start = value.match(/^\s*/)?.[0] ?? '', end = value.match(/\s*$/)?.[0] ?? ''
  return (start + translated + end) as T
}
