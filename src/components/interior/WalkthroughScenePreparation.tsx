import { useEffect, useRef, useState } from 'react'
import type { WalkthroughSource } from '@/lib/walkthrough/source.ts'
import type { WalkthroughScene } from '@/lib/walkthrough/sceneTypes.ts'
import { translate as t } from '@/lib/i18n/index.ts'

/** Explicit scene generation only. No viewer, render job or studio mutation. */
export function WalkthroughScenePreparation({ source }: { source: WalkthroughSource }) {
  const [scene, setScene] = useState<WalkthroughScene | null>(null), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const prepare = async () => {
    setBusy(true); setFailed(false)
    try {
      const { buildWalkthroughScene } = await import('@/lib/walkthrough/scene.ts')
      if (!alive.current) return
      const next = buildWalkthroughScene(source.building, { hardChecksPass: source.state !== 'blocked' })
      if (alive.current) setScene(next)
    } catch { if (alive.current) setFailed(true) }
    finally { if (alive.current) setBusy(false) }
  }
  return <div className="border-t border-line p-5 md:px-7" aria-label={t('Continuous house geometry')}>
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-display text-lg">{t('Continuous house geometry')}</h3>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-dim">{t('Build one shared shell from the source plan. This prepares geometry; it does not start a walking viewer.')}</p></div>
      <button type="button" disabled={busy || source.state === 'blocked'} onClick={prepare} className="min-h-11 border border-line bg-accent px-4 py-3 text-xs text-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">{t(busy ? 'Preparing house geometry…' : 'Prepare house geometry')}</button>
    </div>
    <div aria-live="polite">{failed && <p className="mt-4 text-xs text-bad">{t('The house geometry could not be prepared. Your source plan has not changed.')}</p>}
      {scene && <div className="mt-4 border border-line bg-bg-inset p-4">
        <p className="text-sm">{t(scene.status === 'unsupported' ? 'Source geometry needs review before a shell can be created.' : 'The continuous house shell has been generated.')}</p>
        {scene.status !== 'unsupported' && <p className="mt-2 text-xs text-ink-dim">{t('Floors')}: {scene.floors.length} · {t('Source doors')}: {scene.openings.filter(o => o.kind !== 'window').length} · {t('Stairs')}: {scene.stairs.length} · {t('Surfaces')}: {scene.surfaces.length}</p>}
        {scene.issues.length > 0 && <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 text-xs">{t('Geometry review notes')} ({scene.issues.length})</summary><ul className="space-y-2 text-xs leading-relaxed text-ink-dim">{scene.issues.map((issue, i) => <li key={`${issue.code}:${issue.sourceId}:${i}`}>{issue.message}</li>)}</ul></details>}
      </div>}
    </div>
  </div>
}
