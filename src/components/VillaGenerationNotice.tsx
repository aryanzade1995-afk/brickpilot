import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { Link } from 'react-router-dom'
import { useStudio } from '@/state/studio.ts'

export function VillaGenerationNotice({ blocked = false }: { blocked?: boolean }) {
  useLanguage(s => s.language);

  const notice = useStudio((s) => s.generationNotice)
  if (!notice && !blocked) return null
  return <div role="status" className="my-4 border border-line p-4 text-sm text-ink-dim">
    <p>{translateUi(notice ?? 'This villa did not pass the architecture checks. The 2D plan remains available.')}</p>
    {blocked && <Link to="/workspace/plan" className="mt-3 inline-block text-ink underline">{translateUi("View the 2D plan")}</Link>}
  </div>
}
