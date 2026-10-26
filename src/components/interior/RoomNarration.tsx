import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, RotateCcw, Sparkles, Volume2, VolumeX, X } from 'lucide-react'
import { translate as t, useLanguage } from '@/lib/i18n/index.ts'
import { createGuideContext, type GuideLanguage } from '@/lib/walkthrough/guide.ts'
import { describeRoom, roomName, suggestionCandidates, type DesignSuggestion } from '@/lib/walkthrough/roomExperience.ts'
import { RoomAudioPlayer, unlockRoomNarration } from '@/lib/walkthrough/roomAudio.ts'
import { GuideSpeechSession, type GuideSpeechEnvironment } from '@/lib/walkthrough/guideSpeech.ts'
import type { WalkthroughAppearancePayload, WalkthroughGeometryPayload } from '@/lib/walkthrough/delivery.ts'

export function RoomNarration({ metadata, appearance, walking, roomId, onReview }: {
  metadata: WalkthroughGeometryPayload['metadata']; appearance?: WalkthroughAppearancePayload; walking: boolean; roomId?: string; onReview?: () => void;
}) {
  const language = useLanguage(s => s.language)
  const [voiceLanguage, setVoiceLanguage] = useState<GuideLanguage>('mr'), [enabled, setEnabled] = useState(true)
  const [replay, setReplay] = useState(0), [status, setStatus] = useState<'idle' | 'preparing' | 'speaking' | 'unavailable'>('idle')
  const [analysis, setAnalysis] = useState<{ key: string; suggestion: DesignSuggestion; ai: boolean } | null>(null)
  const [dismissed, setDismissed] = useState('')
  const [expandedFor, setExpandedFor] = useState('')
  const player = useMemo(() => new RoomAudioPlayer(), [])
  const [speech] = useState(() => new GuideSpeechSession(window as unknown as GuideSpeechEnvironment, {
    listening: () => {}, speaking: speaking => setStatus(speaking ? 'speaking' : 'idle'), error: () => setStatus('unavailable'),
  }))
  const context = useMemo(() => createGuideContext(metadata, appearance, roomId ?? null), [metadata, appearance, roomId])
  const room = context?.rooms.find(r => r.id === roomId)
  const key = useMemo(() => context && room ? JSON.stringify([context.planId, room]) : '', [context, room])
  const description = useMemo(() => context ? describeRoom(context, voiceLanguage) : null, [context, voiceLanguage])
  const candidates = useMemo(() => context ? suggestionCandidates(context, language) : [], [context, language])
  const fallback = useMemo(() => [...candidates].sort((a, b) => b.score - a.score)[0], [candidates])
  const stop = useCallback(() => { player.stop(); speech.stop() }, [player, speech])
  const replayRoom = useCallback(() => { unlockRoomNarration(); setEnabled(true); setReplay(n => n + 1) }, [])
  useEffect(() => { speech.activate(); return () => { player.stop(); speech.dispose() } }, [player, speech])
  useEffect(() => {
    if (walking || !enabled || voiceLanguage !== 'mr') return
    // Prepare one source-recorded entrance while the orbit view is open.
    // This only fills the audio cache; it never plays audio before Walk inside.
    const entry = metadata.entries.find(e => /entry|foyer/i.test(metadata.rooms.find(r => r.id === e.roomId)?.name ?? '')) ?? metadata.entries[0]
    if (!entry) return
    const initial = createGuideContext(metadata, appearance, entry.roomId)
    if (!initial?.currentRoomId) return
    const controller = new AbortController()
    void fetch('/api/walkthrough-room/audio', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: initial, language: 'mr' }), signal: controller.signal }).catch(() => {})
    return () => controller.abort()
  }, [walking, enabled, voiceLanguage, metadata, appearance])
  useEffect(() => {
    if (!walking) return
    const keydown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { stop(); return }
      if (event.code !== 'KeyV' || event.repeat || event.ctrlKey || event.altKey || event.metaKey ||
          event.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return
      event.preventDefault(); replayRoom()
    }
    const hidden = () => { if (document.hidden) stop() }
    document.addEventListener('keydown', keydown); document.addEventListener('visibilitychange', hidden)
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('visibilitychange', hidden) }
  }, [walking, replayRoom, stop])
  useEffect(() => {
    stop()
    if (!walking || !enabled || !context || !description || !key) return
    const controller = new AbortController(); let active = true
    const timer = setTimeout(() => {
      setStatus('preparing')
      if (voiceLanguage !== 'mr') { speech.speak(description, voiceLanguage); return }
      void (async () => {
        const response = await fetch('/api/walkthrough-room/audio', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ context, language: 'mr' }), signal: controller.signal })
        const audio = await response.json()
        if (!response.ok || audio.planId !== context.planId || audio.roomId !== context.currentRoomId || !/^\/api\/walkthrough-room\/audio\/[a-f0-9]{64}\.wav$/.test(audio.url)) throw new Error('Room audio is unavailable')
        const wave = await fetch(audio.url, { signal: controller.signal })
        if (!wave.ok) throw new Error('Room audio is unavailable')
        const bytes = await wave.arrayBuffer()
        if (!active) return
        const started = await player.play(bytes, () => { if (active) setStatus('idle') })
        if (active && started) setStatus('speaking')
      })().catch(() => { if (active && !controller.signal.aborted) setStatus('unavailable') })
    }, 850)
    return () => { active = false; clearTimeout(timer); controller.abort(); stop() }
  }, [walking, enabled, key, replay, voiceLanguage, context, description, player, speech, stop])
  useEffect(() => {
    if (!walking || !key || !context) return
    const controller = new AbortController(); let active = true
    const timer = setTimeout(() => {
      void fetch('/api/walkthrough-room', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context, language }), signal: controller.signal }).then(async response => {
        if (!response.ok) return
        const result = await response.json(), s = result.suggestion
        if (!active || result.planId !== context.planId || result.roomId !== context.currentRoomId || !candidates.some(c => c.id === s?.id) ||
            !['painting', 'kitchen', 'plumbing-sanitary', 'electrical', 'furniture-models'].includes(s.section)) return
        // Display only the curated candidate the model selected, never arbitrary model copy or links.
        const candidate = candidates.find(c => c.id === s.id)!
        setAnalysis({ key, suggestion: candidate, ai: result.mode === 'local-ai' })
      }).catch(() => { /* The contextual design proposal remains available. */ })
    }, 500)
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [walking, key, context, language, candidates])
  if (!walking || !room || !fallback) return null
  const suggestion = analysis?.key === key ? analysis.suggestion : fallback, ai = analysis?.key === key && analysis.ai
  const expanded = expandedFor === key
  const params = new URLSearchParams({ tab: 'specifications', section: suggestion.section })
  if (room.finishRoomKey) params.set('room', room.finishRoomKey)
  return <aside className="pointer-events-auto absolute right-3 top-56 z-30 w-[288px] max-w-[calc(100%-1.5rem)] cursor-auto sm:right-4 sm:top-28" aria-label={t('Room narration and design insight')} data-room-experience>
    <div className="mb-3 flex min-h-11 items-center justify-end gap-1.5 rounded-full border border-line bg-bg px-2 shadow-sm">
      <button type="button" aria-label={t(enabled ? 'Mute room narration' : 'Enable room narration')} aria-pressed={enabled} onClick={() => { if (enabled) { setEnabled(false); stop() } else replayRoom() }} className="flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-bg-inset">{enabled ? <Volume2 size={16}/> : <VolumeX size={16}/>}</button>
      <select aria-label={t('Narration language')} value={voiceLanguage} onChange={e => { unlockRoomNarration(); setVoiceLanguage(e.target.value as GuideLanguage) }} className="min-h-11 min-w-0 flex-1 bg-transparent text-xs outline-offset-2"><option value="mr">मराठी</option><option value="en">English</option><option value="hi">हिन्दी</option></select>
      <span className="max-w-20 truncate text-[9px] text-ink-faint" role="status">{enabled && t(status === 'preparing' ? 'Preparing voice…' : status === 'speaking' ? 'Narrating…' : status === 'unavailable' ? 'Tap replay for audio' : 'Room narration')}</span>
      <button type="button" aria-label={t('Replay room description')} title={t('V · Replay description')} onClick={replayRoom} className="flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-bg-inset"><RotateCcw size={14}/></button>
    </div>
    <p className="sr-only" aria-live="polite">{description}</p>
    {dismissed !== key && <section className="overflow-hidden rounded-xl border border-line-strong bg-bg-raised shadow-[0_12px_40px_rgba(23,23,23,0.14)]" aria-labelledby="room-design-insight-title" data-room-insight>
      <div className="max-h-[calc(100dvh-30rem)] overflow-y-auto sm:max-h-[calc(100dvh-21rem)]">
        <div className="flex items-center gap-2 px-3 pt-1"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#E7ECE5] text-[#50634F]"><Sparkles size={11}/></span><p className="flex-1 font-mono text-[8px] uppercase tracking-[0.1em] text-ink-dim">{t(ai ? 'AI design insight' : 'Design insight')}</p><button type="button" aria-label={t('Dismiss design suggestion')} onClick={() => setDismissed(key)} className="-mr-2 flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink-faint hover:bg-bg-inset hover:text-ink"><X size={14}/></button></div>
        <div className="px-3 pb-3"><p className="mb-1 text-[9px] text-ink-faint">{roomName(room, language)}{room.areaM2 ? ` · ${room.areaM2} m²` : ''}</p><h3 id="room-design-insight-title" className="font-display text-[18px] leading-tight tracking-[-0.01em]">{suggestion.title}</h3><p className={`mt-2 text-[12px] leading-relaxed text-ink-dim ${expanded ? '' : 'line-clamp-3'}`}>{suggestion.body}</p>
          <div className="mt-3 flex gap-1.5" aria-label={t('Suggested palette')}>{suggestion.palette.map(p => <div key={p.label} className="min-w-0 flex-1"><span className="block h-3 rounded-sm border border-black/5" style={{ background: p.colour }}/>{expanded && <span className="mt-1 block truncate text-[9px] text-ink-faint" title={p.label}>{p.label}</span>}</div>)}</div>
          {expanded && <p className="mt-3 border-t border-line pt-3 text-[10px] leading-relaxed text-ink-faint">{suggestion.reason}</p>}
        </div>
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-line bg-bg/70 px-3"><button type="button" aria-expanded={expanded} aria-label={t(expanded ? 'Hide suggestion details' : 'Show suggestion details')} onClick={() => setExpandedFor(expanded ? '' : key)} className="inline-flex min-h-11 items-center gap-1 text-[10px] text-ink-faint">{t('Details')}<ChevronDown size={12} className={expanded ? 'rotate-180' : ''}/></button><Link to={`/workspace/finishes?${params}`} onClick={() => { stop(); onReview?.() }} className="inline-flex min-h-11 items-center gap-1 text-[10px] text-ink underline decoration-line-strong underline-offset-4">{t('Review finishes')}<ArrowUpRight size={12}/></Link></footer>
    </section>}
  </aside>
}
