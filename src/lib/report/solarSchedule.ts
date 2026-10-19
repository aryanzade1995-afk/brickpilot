import type { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { SolarEstimate } from '../solar/estimate.ts'
export function appendSolarSchedule(doc: jsPDF, solar: SolarEstimate, startY: number) {
  const delivery = solar.delivery
  autoTable(doc, { startY, margin: { top: 42, left: 42, right: 42, bottom: 60 }, head: [['Solar layout / qualification', 'Basis']], body: [
    ['Layout status', delivery?.layoutStatus ?? 'Historical record; canonical schedule unavailable'],
    ['Roof / layout signatures', delivery ? `${delivery.roofSignature ?? 'Not available'} / ${delivery.layoutSignature ?? 'Not available'}` : 'Not recorded in older estimate'],
    ['Reserved areas', delivery?.reservedAreaCount ?? 'Not recorded'],
    ...[...solar.notes, ...solar.inclusions, ...solar.exclusions, ...solar.inverter.reasons, ...solar.energy.reasons, ...solar.energy.basis,
      ...(delivery?.assumptions ?? []), ...solar.sources.map(s => `Source: ${s}`)].map(note => ['Qualification', note.replaceAll('₹', 'Rs ')]),
  ], styles: { fontSize: 8, cellPadding: 5, overflow: 'linebreak' }, headStyles: { fillColor: [51, 51, 51] } })
  if (!delivery?.arrays.length) return
  const y = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? startY
  autoTable(doc, { startY: y + 18, margin: { top: 42, left: 42, right: 42, bottom: 60 },
    head: [['Canonical array / roof', 'Versioned module / physical dimensions', 'Count / W', 'DC kWp', 'Local pose']],
    body: delivery.arrays.map(a => [`${a.id}\n${a.roofSurfaceId}`, `${a.specificationName}\n${a.specificationId}@${a.specificationRevision ?? 'revision unknown'}\n${a.specificationKey}\n${a.widthMm} x ${a.slopeLengthMm} x ${a.thicknessMm} mm\nSource: ${a.specificationSource}`,
      `${a.count} x ${a.ratedPowerW} W`, a.capacityKwp, `${a.azimuthDeg} deg azimuth\n${a.tiltDeg} deg tilt\nRoof ${a.baseElevationMm} mm\nMount ${a.mountingHeightMm} mm`]),
    styles: { fontSize: 7, cellPadding: 4, overflow: 'linebreak' }, headStyles: { fillColor: [51, 51, 51] }, rowPageBreak: 'avoid',
  })
}
