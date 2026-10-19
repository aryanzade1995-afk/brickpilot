import type { CostEstimate } from './boq.ts'
import { solarScheduleRows, SOLAR_SCHEDULE_HEADERS } from '../solar/delivery.ts'

/** Browser-compatible workbook; quantities/rates are numbers and amounts are formulas. */
export async function buildBoqExcel(cost: CostEstimate, projectName = 'Formstead project'): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  book.creator = 'Formstead'; book.title = projectName
  const summary = book.addWorksheet('Summary')
  const money = '#,##0.00;[Red](#,##0.00);"–"'
  const decorate = (sheet: import('exceljs').Worksheet, widths: number[], header: number) => {
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
    sheet.views = [{ state: 'frozen', ySplit: header }]
    sheet.getRow(1).height = 30
    sheet.getRow(header).height = 24
    sheet.getRow(1).font = { name: 'Calibri', size: 18, bold: true }
    sheet.getRow(header).font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(header).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } }
    sheet.eachRow((row, n) => {
      row.alignment = { vertical: 'top', wrapText: true }
      if (n > header) {
        row.height = 42
        if (n % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F4' } }
      }
    })
    sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${header}:${header}` }
    sheet.headerFooter = { oddFooter: `${cost.label.replaceAll('±', '+/-')} | &P / &N` }
  }
  summary.addRows([[projectName], [cost.label], [cost.qualification], ['Rate version', cost.rateVersion], [],
    ['Trade / add-on', 'Amount (INR)', 'Share of works', 'Material (INR)', 'Labour (INR)']])
  let direct = 0
  cost.tradeTotals.forEach((trade, i) => {
    const name = `${String(i + 1).padStart(2, '0')} ${trade.trade}`.replaceAll('&', 'and').slice(0, 31)
    const sheet = book.addWorksheet(name)
    sheet.addRows([[trade.trade], [cost.label], ['Rate version', cost.rateVersion], [],
      ['Work / specification', 'Room / floor', 'Qty', 'Unit', 'Rate INR', 'Amount INR', 'Material INR', 'Labour INR', 'Spec ID', 'Assumption']])
    const lines = cost.boq.filter(l => l.group === trade.trade)
    for (const line of lines) {
      const row = sheet.rowCount + 1
      sheet.addRow([`${line.label}\n${line.specification}`, line.roomId ?? (line.floor === undefined ? 'Whole home' : `Floor ${line.floor}`),
        line.qty, line.unit, line.rate, { formula: `C${row}*E${row}`, result: line.amount }, line.materialAmount, line.labourAmount, line.specId, line.note])
    }
    const last = sheet.rowCount, totalRow = last + 1
    sheet.addRow(['WORKS TOTAL', null, null, null, null, { formula: lines.length ? `SUM(F6:F${last})` : '0', result: trade.amount },
      { formula: lines.length ? `SUM(G6:G${last})` : '0', result: trade.material }, { formula: lines.length ? `SUM(H6:H${last})` : '0', result: trade.labour }])
    sheet.getRow(totalRow).font = { bold: true }
    for (const col of [3, 5, 6, 7, 8]) sheet.getColumn(col).numFmt = money
    sheet.autoFilter = { from: 'A5', to: `J${Math.max(5, last)}` }
    decorate(sheet, [48, 24, 13, 10, 16, 18, 18, 18, 26, 56], 5)
    summary.addRow([trade.trade, { formula: `'${name}'!F${totalRow}`, result: trade.amount }, trade.share, trade.material, trade.labour])
    direct += trade.amount
  })
  const subtotal = summary.rowCount + 1
  summary.addRow(['WORKS SUBTOTAL', { formula: `SUM(B7:B${subtotal - 1})`, result: direct }])
  for (const line of cost.lines.slice(1)) summary.addRow([line.label, line.expected, null, null, null, line.note])
  const end = summary.rowCount
  summary.addRow(['EXPECTED PROJECT TOTAL', { formula: `SUM(B${subtotal}:B${end})`, result: cost.expected }])
  summary.addRows([['Range - low (INR)', cost.total.low], ['Range - high (INR)', cost.total.high], ['INR / sq ft', cost.ratePerSqft], [],
    ['Assumptions'], ...cost.assumptions.map(v => [v]), ['Included'], ...cost.included.map(v => [v]),
    ['Excluded'], ...cost.excluded.map(v => [v]), ['Sources'], ...cost.sources.map(v => [v])])
  summary.getColumn(2).numFmt = money; summary.getColumn(3).numFmt = '0.0%'
  summary.getColumn(4).numFmt = money; summary.getColumn(5).numFmt = money
  decorate(summary, [76, 22, 20, 22, 22, 65], 6)
  for (let r = end + 6; r <= summary.rowCount; r++) { summary.mergeCells(r, 1, r, 6); summary.getRow(r).height = 48 }
  if (cost.solar) {
    const solar = cost.solar, sheet = book.addWorksheet('Solar assessment')
    sheet.addRows([['Rooftop solar'], [cost.label], ['Gross direct solar cost before shared add-ons and unconfirmed tax; no subsidy deducted'], [], ['Assessment', 'Value / basis'],
      ['Status', solar.status], ['Goal', solar.objective], ['Applied PV panels', solar.panelCount], ['Applied DC kWp', solar.capacityKwp],
      ['Gross installation INR', solar.grossInstallationCost], ['Legacy allowance INR', solar.legacyAllowanceCost], ['Potential assistance', 'Unverified; INR 0 deducted'],
      ['Official scheme portal', solar.assistance.url], ['Backup configuration', solar.backup], ['Inverter compatibility', solar.inverter.state],
      ['Layout status', solar.delivery?.layoutStatus ?? 'Historical schedule unavailable'], ['Roof signature', solar.delivery?.roofSignature ?? 'Not recorded'],
      ['Layout signature', solar.delivery?.layoutSignature ?? 'Not recorded'], ['Reserved areas', solar.delivery?.reservedAreaCount ?? 'Not recorded'],
      ['Annual energy kWh', solar.energy.annualKwh ? `${solar.energy.annualKwh.low} - ${solar.energy.annualKwh.high}` : solar.energy.state],
      ...[...solar.notes, ...solar.inverter.reasons, ...solar.energy.reasons, ...solar.energy.basis, ...solar.inclusions, ...solar.exclusions, ...(solar.delivery?.assumptions ?? []), ...solar.sources].map(v => ['Basis', v])])
    decorate(sheet, [36, 110], 5)
    if (solar.delivery?.arrays.length) {
      const schedule = book.addWorksheet('Solar panel schedule')
      schedule.addRows([['Canonical rooftop PV inventory'], [`Layout: ${solar.delivery.layoutStatus}`],
        [`Roof: ${solar.delivery.roofSignature}; layout: ${solar.delivery.layoutSignature}`], [], SOLAR_SCHEDULE_HEADERS, ...solarScheduleRows(solar.delivery)])
      decorate(schedule, [20, 30, 45, 12, 14, 14, 32, 18, 12, 20, 22, 60], 5)
      schedule.getColumn(6).numFmt = '0.000###'
    }
  }
  book.calcProperties.fullCalcOnLoad = true
  const bytes = await book.xlsx.writeBuffer()
  return new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
