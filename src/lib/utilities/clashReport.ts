import { clashTypeLabel, type Clash } from './clashes.ts'
import type { UtilityFloor } from './plan.ts'
import { UTILITY_LAYERS } from './plan.ts'

export const clashRoomNames = (c: Clash, model: UtilityFloor) => c.roomIds.map(id => model.floor.rooms.find(r => r.id === id)?.name ?? id).join(', ')
export const clashDistance = (c: Clash) => c.distance === null ? 'Not applicable' : `${c.distance.toFixed(1)} mm · ${c.distanceBasis === 'plan' ? 'Plan distance only' : '3D separation'}`
export const clashLayers = (c: Clash) => `${UTILITY_LAYERS[c.layerA].label} / ${UTILITY_LAYERS[c.layerB].label}`
const cell = (value: string) => `"${(/^\s*[=+\-@\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`
export function clashCsv(clashes: Clash[], model: UtilityFloor, project: string) {
  const header = ['Project', 'Floor', 'ID', 'Type', 'Severity', 'Layers', 'Rooms', 'Rule', 'Distance mm', 'Distance basis', 'Verification', 'Status', 'Note', 'Item A', 'Item B', 'X mm', 'Y mm', 'Height mm', 'Suggested review', 'Basis']
  return '\uFEFF' + [header, ...clashes.map(c => [project, model.floor.name, c.id, c.type, c.severity, clashLayers(c), clashRoomNames(c, model), c.rule, c.distance === null ? '' : c.distance.toFixed(1), c.distanceBasis, c.certainty, c.status, c.note ?? '', c.itemA, c.itemB, c.position.x.toFixed(1), c.position.y.toFixed(1), c.elevationMm === null ? '' : c.elevationMm.toFixed(1), c.suggestion, 'Concept checks; not statutory compliance. Resolved is a user review status, not a geometry repair.'])].map(row => row.map(v => cell(String(v))).join(',')).join('\r\n')
}
export function downloadClashCsv(clashes: Clash[], model: UtilityFloor, project: string) {
  const url = URL.createObjectURL(new Blob([clashCsv(clashes, model, project)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = `utility-problems-floor-${model.floor.level}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Render report pages via SVG so Hindi/Marathi and long notes retain the
 * browser's fonts. Every page repeats title, filters/date basis and pagination. */
export async function downloadClashPdf(clashes: Clash[], model: UtilityFloor, project: string, translate: (s: string) => string, filterDescription: string) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const measuring = document.createElement('canvas').getContext('2d')!
  const wrap = (text: string, maxWidth: number, size = 14) => {
    measuring.font = `${size}px Arial, sans-serif`
    const lines: string[] = []; let line = ''
    for (const word of text.split(/\s+/)) {
      if (measuring.measureText(`${line} ${word}`).width > maxWidth && line) { lines.push(line); line = '' }
      // Long geometry IDs/notes must also wrap without falling off the page.
      for (const char of (line ? ' ' : '') + word) { if (measuring.measureText(line + char).width > maxWidth && line) { lines.push(line); line = '' } line += char }
    }
    if (line) lines.push(line)
    return lines
  }
  type Line = { text: string; size: number; color?: string }
  const pages: Line[][] = [[]]
  const add = (text: string, size = 14, color = '#33352f') => {
    for (const line of wrap(text, 690, size)) { if (pages.at(-1)!.length >= 44) pages.push([]); pages.at(-1)!.push({ text: line, size, color }) }
  }
  add(translate('Concept checks only. This is not a compliance certificate.'), 14)
  add(translate('Resolved records your review; the checker does not move pipes or wires.'), 14)
  add(translate('Heights follow the 3D concept where available. Unknown heights require checking.'), 14)
  if (!clashes.length) add(translate('No problems match these filters.'))
  for (const c of clashes) {
    const block: Line[] = []
    const line = (text: string, size = 14) => block.push(...wrap(text, 690, size).map(text => ({ text, size })))
    line(`${c.id} · ${translate(c.severity)} · ${translate(clashTypeLabel(c.type))} · ${translate(c.status)}`, 16)
    line(`${translate('Layers')}: ${translate(clashLayers(c))}`)
    line(`${translate('Rooms')}: ${translate(clashRoomNames(c, model))}`)
    line(`${translate('Rule')}: ${translate(c.rule)}`)
    line(`${translate('Distance')}: ${translate(clashDistance(c))} · ${translate(c.certainty === 'needs-verification' ? 'Needs checking' : 'Concept model')}`)
    line(`${translate('Items')}: ${c.itemA} / ${c.itemB}`)
    line(`${translate('Suggested review')}: ${translate(c.suggestion)}`)
    if (c.note) line(`${translate('Review note')}: ${c.note}`)
    block.push({ text: ' ', size: 14 })
    if (pages.at(-1)!.length && pages.at(-1)!.length + block.length > 44) pages.push([])
    for (const row of block) {
      if (pages.at(-1)!.length >= 44) { pages.push([{ text: `${c.id} · ${translate('Continued')}`, size: 16 }]) }
      pages.at(-1)!.push(row)
    }
  }
  for (let index = 0; index < pages.length; index++) {
    if (index) pdf.addPage()
    const title = wrap(`${project} · ${translate('Utility problems')}`, 690, 23)
    const header = [...title.map(text => ({ text, size: 23 })), ...wrap(`${translate(model.floor.name)} · ${new Date().toLocaleDateString()} · ${filterDescription}`, 690, 11).map(text => ({ text, size: 11 }))]
    // Header can wrap too. Scale the page image to keep all content printable.
    const lines = [...header, { text: ' ', size: 12 }, ...pages[index]]
    let y = 42
    const texts = lines.map(l => { y += Math.max(20, l.size + 6); return `<text x="40" y="${y}" font-size="${l.size}" fill="${'color' in l ? l.color : '#33352f'}">${escape(l.text)}</text>` }).join('')
    const h = Math.max(1100, y + 80)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="780" height="${h}" font-family="Arial, sans-serif"><rect width="100%" height="100%" fill="#fff"/>${texts}<text x="40" y="${h - 28}" font-size="11">Formstead · ${index + 1} / ${pages.length}</text></svg>`
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    try {
      const image = new Image(); image.src = url; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = 1560; canvas.height = h * 2
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      pdf.addImage(canvas.toDataURL('image/jpeg', .92), 'JPEG', 10, 8, 190, Math.min(280, h * 190 / 780))
    } finally { URL.revokeObjectURL(url) }
  }
  pdf.save(`utility-problems-floor-${model.floor.level}.pdf`)
}
