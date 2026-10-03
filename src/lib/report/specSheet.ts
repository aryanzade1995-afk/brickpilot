import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { SpecificationRow } from '../cost/schedule.ts'
import type { CostEstimate } from '../cost/boq.ts'

export type SheetEstimate = Pick<CostEstimate, 'label' | 'qualification' | 'expected' | 'total' | 'ratePerSqft' | 'rateVersion' | 'tradeTotals' | 'included' | 'excluded' | 'assumptions' | 'sources'>
export type SpecSheetData = { projectName: string; schedule: SpecificationRow[]; cost: SheetEstimate; photos?: Record<string, string> }
const rupees = (n: number) => `Rs ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)}`
type Pdf = jsPDF & { lastAutoTable?: { finalY: number } }

/** Only audited, local close-up assets. Callers can supply bytes for offline exports. */
export async function schedulePhotos(rows: SpecificationRow[]): Promise<Record<string, string>> {
  if (typeof document === 'undefined') return {}
  const photos: Record<string, string> = {}
  await Promise.all([...new Set(rows.map(r => r.photo).filter((p): p is string => !!p))].map(async file => {
    if (!/^public\/specs\/textures\/[a-z0-9_-]+\.jpg$/.test(file)) return
    const response = await fetch(`/${file.replace(/^public\//, '')}`)
    if (!response.ok) throw new Error('A specification photo could not load. Please try the export again.')
    const blob = await response.blob()
    photos[file] = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob)
    })
  }))
  return photos
}

export function appendSpecificationSchedule(doc: Pdf, rows: SpecificationRow[], startY: number, photos: Record<string, string>) {
  const width = doc.internal.pageSize.getWidth(), margin = 42
  autoTable(doc, { startY, margin: { left: margin, right: margin, top: margin, bottom: 60 },
    head: [['Real close-up', 'Where / specification', 'Choice', 'Quantity']],
    body: rows.map(r => ['', `${r.where}\n${r.label}`, `${r.choice}\n${r.item}/${r.optionId}`, r.quantity]),
    rowPageBreak: 'avoid', theme: 'grid', styles: { font: 'helvetica', fontSize: 8, cellPadding: 5, minCellHeight: 40, overflow: 'linebreak', valign: 'middle', textColor: [26, 26, 26] },
    headStyles: { fillColor: [51, 51, 51] }, alternateRowStyles: { fillColor: [247, 247, 247] },
    columnStyles: { 0: { cellWidth: 58 }, 1: { cellWidth: (width - margin * 2 - 58) * .42 }, 2: { cellWidth: (width - margin * 2 - 58) * .4 } },
    didDrawCell: cell => {
      if (cell.section !== 'body' || cell.column.index !== 0) return
      const row = rows[cell.row.index], image = row.photo ? photos[row.photo] : undefined
      if (image) doc.addImage(image, 'JPEG', cell.cell.x + 6, cell.cell.y + (cell.cell.height - 28) / 2, 44, 28, undefined, 'FAST')
    } })
  return (doc.lastAutoTable?.finalY ?? startY) + 18
}

export async function buildSpecSheetPdf(data: SpecSheetData): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' }) as Pdf
  const photos = data.photos ?? await schedulePhotos(data.schedule)
  doc.setFont('times', 'normal').setFontSize(24)
  const title = doc.splitTextToSize(data.projectName, 500)
  doc.text(title, 42, 56)
  let y = 56 + title.length * 28
  doc.setFont('helvetica', 'normal').setFontSize(10)
  doc.text('Specification sheet · showroom / contractor reference', 42, y); y += 20
  doc.setFontSize(8); doc.text(doc.splitTextToSize(data.cost.qualification.replaceAll('₹', 'Rs '), 500), 42, y); y += 40
  y = appendSpecificationSchedule(doc, data.schedule, y, photos)
  if (y > 600) { doc.addPage(); y = 42 }
  doc.setFont('helvetica', 'bold').setFontSize(12); doc.text('CONCEPT ESTIMATE', 42, y); y += 18
  doc.setFont('helvetica', 'normal').setFontSize(10)
  doc.text(`${rupees(data.cost.expected)} expected · ${rupees(data.cost.total.low)} – ${rupees(data.cost.total.high)}`, 42, y); y += 18
  doc.text(`${rupees(data.cost.ratePerSqft)} / sq ft`, 42, y); y += 20
  autoTable(doc, { startY: y, margin: { left: 42, right: 42, bottom: 60 }, head: [['Trade', 'Amount (INR)', 'Share of works']], body: data.cost.tradeTotals.map(t => [t.trade, rupees(t.amount), `${(t.share * 100).toFixed(1)}%`]), styles: { fontSize: 9 }, headStyles: { fillColor: [51, 51, 51] } })
  const notes = [...data.cost.assumptions, ...data.cost.excluded.map(v => `Excluded: ${v}`), ...data.cost.sources.map(v => `Source: ${v}`)]
  doc.addPage(); doc.setFont('helvetica', 'bold').setFontSize(12); doc.text('ASSUMPTIONS, EXCLUSIONS & PHOTO CREDITS', 42, 50)
  autoTable(doc, { startY: 68, margin: { left: 42, right: 42, bottom: 60 }, body: [...notes.map(v => [v.replaceAll('₹', 'Rs ')]), ...[...new Map(data.schedule.filter(r => r.photo).map(r => [r.photo, `${r.photoSource} · ${r.credit} · CC0 texture close-up, not an installed product photograph`])).values()].map(v => [v])], styles: { fontSize: 8, cellPadding: 5 }, theme: 'plain' })
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFont('helvetica', 'normal').setFontSize(7)
    doc.text(data.cost.label, 42, 814); doc.text(`${page} / ${pages}`, 552, 802, { align: 'right' })
    doc.text('Approximate; final products, site, structural design and contractor quotes determine the cost.', 42, 802)
  }
  return doc.output('blob')
}
