import { Link } from 'react-router-dom'
import { useStudio } from '@/state/studio.ts'

export function VillaGenerationNotice({ blocked = false }: { blocked?: boolean }) {
  const notice = useStudio((s) => s.generationNotice)
  if (!notice && !blocked) return null
  return <div role="status" className="my-4 border border-line p-4 text-sm text-ink-dim">
    <p>{notice ?? 'This villa did not pass the architecture checks. The 2D plan remains available.'}</p>
    {blocked && <Link to="/workspace/plan" className="mt-3 inline-block text-ink underline">View the 2D plan</Link>}
  </div>
}
