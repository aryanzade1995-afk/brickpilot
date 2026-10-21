import type { ExportItem } from './ExportDropdown.tsx'
import type { BlenderResult } from '@/state/blender.ts'
import { buildingJobId } from '@/state/solarArtifacts.ts'
import { saveBlob } from '@/lib/export/fileSaver.ts'

export const VILLA_CAD_HELP = '3D meshes in metres, with base colours. Import DXF in AutoCAD or DAE in SketchUp, then save as DWG or SKP. Import support depends on your edition. Textures and parametric solids are not included.'

export function villaCadExportItems(source: BlenderResult | undefined): ExportItem[] {
  const jobId = buildingJobId(source)
  if (!source || !jobId) return []
  const scope = 'artifactScope' in source && source.artifactScope === 'building-plus-solar' ? 'building-plus-solar' : 'building-only'
  return (['dxf', 'dae'] as const).map(format => ({
    id: `villa-cad-${format}`,
    label: format === 'dxf'
      ? scope === 'building-plus-solar' ? 'AutoCAD 3D · building + solar' : 'AutoCAD 3D · building only'
      : scope === 'building-plus-solar' ? 'SketchUp · building + solar' : 'SketchUp · building only',
    ext: `.${format}`,
    onExport: async () => {
      const response = await fetch(`/api/villas/${jobId}/cad/${format}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Could not export this villa. Please try again.')
      }
      saveBlob(await response.blob(), `villa-${source.seed}-${scope}.${format}`)
    },
  }))
}
