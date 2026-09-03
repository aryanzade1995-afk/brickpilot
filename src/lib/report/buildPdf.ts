import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { Brief } from '@/lib/model/brief.ts'
import { BUILDING_TYPE_LABEL, CHARACTER_LABEL, DIRECTION_LABEL } from '@/lib/model/brief.ts'
import type { Design } from '@/lib/engine/types.ts'
import type { ValidationReport } from '@/lib/rules/index.ts'
import type { CostEstimate } from '@/lib/cost/index.ts'
import { ZONE_LABEL } from '@/lib/model/canonical.ts'
import { formatINR as fINR, formatINRShort as fShort } from '@/lib/format.ts'

/** jsPDF's built-in Helvetica has no ₹ glyph (renders as mojibake) — use "Rs". */
const money = (n: number) => fINR(n).replace('₹', 'Rs ')
const moneyShort = (n: number) => fShort(n).replace('₹', 'Rs ')
const moneyRange = (lo: number, hi: number, short = false) =>
  `${(short ? moneyShort : money)(lo)} – ${(short ? moneyShort : money)(hi)}`

export type ReportImage = { label: string; dataUrl: string }

export type ReportData = {
  projectName: string
  brief: Brief
  design: Design
  report: ValidationReport
  cost: CostEstimate
  /** one rasterised plan per floor, in floor order */
  planImages: ReportImage[]
  /** 0–2 massing captures (front, top) */
  massingImages: ReportImage[]
  /** generated building-concept / interior images, if any */
  conceptImages: ReportImage[]
}

const ACCENT: [number, number, number] = [224, 82, 30]
const INK: [number, number, number] = [26, 24, 22]
const DIM: [number, number, number] = [110, 104, 96]
const RULE: [number, number, number] = [210, 205, 196]

type Doc = jsPDF & { lastAutoTable?: { finalY: number } }

export async function buildReportPdf(data: ReportData): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' }) as Doc
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 42
  const contentW = W - M * 2

  let y = M

  const ensure = (need: number) => {
    if (y + need > H - 60) {
      doc.addPage()
      y = M
    }
  }

  /** `keepWith` reserves room for the first block after the heading so it
   *  never orphans at the foot of a page */
  const heading = (text: string, keepWith = 60) => {
    ensure(46 + keepWith)
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...INK)
    doc.text(text.toUpperCase(), M, y)
    y += 8
    doc.setDrawColor(...ACCENT).setLineWidth(1.5)
    doc.line(M, y, M + 34, y)
    y += 18
  }

  const paragraph = (text: string, color = DIM) => {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...color)
    const lines = doc.splitTextToSize(text, contentW)
    ensure(lines.length * 12 + 6)
    doc.text(lines, M, y)
    y += lines.length * 12 + 8
  }

  const table = (head: string[], body: (string | number)[][]) => {
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, textColor: INK, lineColor: RULE },
      headStyles: { fillColor: [244, 241, 234], textColor: INK, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 249, 246] },
      theme: 'grid',
    })
    y = (doc.lastAutoTable?.finalY ?? y) + 18
  }

  const image = ({ label, dataUrl }: ReportImage, maxH = 250) => {
    let props: { width: number; height: number }
    try {
      props = doc.getImageProperties(dataUrl)
    } catch {
      return
    }
    const ratio = props.height / props.width
    let w = contentW
    let h = w * ratio
    if (h > maxH) {
      h = maxH
      w = h / ratio
    }
    ensure(h + 22)
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...DIM)
    doc.text(label.toUpperCase(), M, y)
    y += 8
    const fmt = dataUrl.includes('image/jpeg') ? 'JPEG' : 'PNG'
    doc.addImage(dataUrl, fmt, M, y, w, h, undefined, 'FAST')
    y += h + 16
  }

  const footer = () => {
    const pages = doc.getNumberOfPages()
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p)
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...DIM)
      doc.text(
        'BrickPilot — concept feasibility only. A licensed architect and engineers must verify before permits.',
        M,
        H - 28,
      )
      doc.text(`${p} / ${pages}`, W - M, H - 28, { align: 'right' })
    }
  }

  /* ---------------------------------- cover --------------------------------- */
  const { brief, design, report, cost } = data
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...ACCENT)
  doc.text('BRICKPILOT', M, y)
  y += 30
  doc.setFont('times', 'normal').setFontSize(30).setTextColor(...INK)
  doc.text(doc.splitTextToSize(data.projectName, contentW), M, y)
  y += 34
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(...DIM)
  doc.text('Concept Feasibility Report', M, y)
  y += 16
  doc.setFontSize(9)
  doc.text(
    `${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}  ·  ${CHARACTER_LABEL[brief.style.character]} character`,
    M,
    y,
  )
  y += 26
  doc.setDrawColor(...RULE).setLineWidth(0.75)
  doc.line(M, y, W - M, y)
  y += 22

  const facts: [string, string][] = [
    ['Validation score', `${report.score} / 100`],
    ['Hard checks', report.hardChecksPass ? 'Pass' : 'Fail'],
    ['Est. build cost', moneyRange(cost.total.low, cost.total.high, true)],
    ['Built area', `${design.builtAreaSqm.toFixed(0)} m²`],
    ['Storeys', String(design.floors.length)],
    ['Site coverage', `${(design.coverage * 100).toFixed(0)} %`],
    ['Openings', `${design.openingCounts.doors} doors · ${design.openingCounts.windows} windows`],
    ['Plot', `${brief.site.plotWidth} × ${brief.site.plotDepth} m, facing ${DIRECTION_LABEL[brief.site.facing]}`],
  ]
  const colW = contentW / 2
  facts.forEach(([k, v], i) => {
    const cx = M + (i % 2) * colW
    if (i % 2 === 0 && i > 0) y += 32
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...DIM)
    doc.text(k.toUpperCase(), cx, y)
    doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(...INK)
    doc.text(v, cx, y + 13)
  })
  y += 42

  /* ------------------------------ brief summary ---------------------------- */
  heading('The brief')
  table(
    ['Parameter', 'Value'],
    briefRows(brief),
  )

  /* ------------------------------ floor plans ----------------------------- */
  data.planImages.forEach((img, idx) => {
    const floor = design.floors[idx]
    heading(`${floor?.name ?? img.label} plan`, 220)
    image(img, 300)
    if (floor) {
      table(
        ['Space', 'Zone', 'Size', 'Area'],
        floor.rooms.map((r) => [
          r.name,
          ZONE_LABEL[r.zone],
          `${(r.rect.w / 1000).toFixed(1)} × ${(r.rect.h / 1000).toFixed(1)} m`,
          `${r.area.toFixed(1)} m²`,
        ]),
      )
    }
  })

  /* --------------------------------- massing ------------------------------ */
  if (data.massingImages.length) {
    heading('3D massing', 200)
    data.massingImages.forEach((img) => image(img, 240))
  }

  /* ------------------------------- validation ----------------------------- */
  heading('Validation findings', 90)
  paragraph(
    `Rule pack ${report.pack} · score ${report.score}/100 · ${report.counts.error} errors · ${report.counts.warning} warnings · deterministic checks: ${report.checksRun.join(', ')}.`,
  )
  if (report.findings.length === 0) {
    paragraph('No findings — the concept passes every rule in this pack.', INK)
  } else {
    table(
      ['Severity', 'Code', 'Finding'],
      report.findings.map((f) => [f.severity.toUpperCase(), f.code, f.message]),
    )
  }

  /* ---------------------------------- cost -------------------------------- */
  heading('Build-cost estimate', 90)
  paragraph(`${cost.basis} · confidence ${cost.confidence} · ${cost.currency}.`)
  table(
    ['Item', 'Note', 'Low', 'High'],
    cost.lines.map((l) => [l.label, l.note, money(l.low), money(l.high)]),
  )
  ensure(24)
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK)
  doc.text('Expected total', M, y)
  doc.text(money(cost.expected), W - M, y, { align: 'right' })
  y += 20
  table(
    ['Included', 'Excluded'],
    zip(cost.included, cost.excluded),
  )
  paragraph(`Sources — ${cost.sources.join(' · ')}`)

  /* -------------------------------- concepts ------------------------------ */
  if (data.conceptImages.length) {
    heading('Generated concepts', 200)
    paragraph('Generative — materials, lighting and furnishing are assumptions, not measured output.')
    data.conceptImages.forEach((img) => image(img, 250))
  }

  footer()
  return doc.output('blob')
}

/* ------------------------------- helpers -------------------------------- */

function briefRows(b: Brief): string[][] {
  const p = b.rooms.priorities
  const on = (v: boolean) => (v ? 'Yes' : 'No')
  const wants = Object.entries({
    'Covered parking': p.coveredParking,
    Verandah: p.coveredVerandah,
    Utility: p.utility,
    Pooja: p.pooja,
    Courtyard: p.courtyard,
    Garden: p.garden,
    'Compound wall': p.compoundWall,
  })
    .filter(([, v]) => v)
    .map(([k]) => k)
  return [
    ['Typology', BUILDING_TYPE_LABEL[b.project.buildingType]],
    ['Character', CHARACTER_LABEL[b.style.character]],
    ['Plot', `${b.site.plotWidth} m × ${b.site.plotDepth} m`],
    ['Facing', DIRECTION_LABEL[b.site.facing]],
    ['Road edges', b.site.roadEdges.map((d) => DIRECTION_LABEL[d]).join(', ')],
    [
      'Setbacks (N/E/S/W)',
      `${b.site.setbacks.N} / ${b.site.setbacks.E} / ${b.site.setbacks.S} / ${b.site.setbacks.W} m`,
    ],
    ['Occupants', String(b.spaces.occupants)],
    ['Living / dining', b.spaces.livingDining],
    ['Step-free', on(b.spaces.stepFree)],
    ['Storeys', `Ground + ${b.levels.storeys}`],
    ['Floor to floor', `${b.levels.floorToFloor} m`],
    ['Bedrooms (en-suite)', String(b.rooms.bedroomsWithBath)],
    ['Bedrooms (shared bath)', String(b.rooms.bedroomsNoBath)],
    ['Shared baths', String(b.rooms.sharedBaths)],
    ['Studies', String(b.rooms.studies)],
    ['Balcony', on(b.rooms.balcony)],
    ['Priorities', wants.join(', ') || '—'],
  ]
}

function zip(a: string[], b: string[]): string[][] {
  const n = Math.max(a.length, b.length)
  const out: string[][] = []
  for (let i = 0; i < n; i++) out.push([a[i] ?? '', b[i] ?? ''])
  return out
}
