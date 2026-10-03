import type { CostEstimate } from './boq.ts'

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
    sheet.addRow(['WORKS TOTAL', '', '', '', '', { formula: lines.length ? `SUM(F6:F${last})` : '0', result: trade.amount },
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
  for (const line of cost.lines.slice(1)) summary.addRow([line.label, line.expected, '', '', '', line.note])
  const end = summary.rowCount
  summary.addRow(['EXPECTED PROJECT TOTAL', { formula: `SUM(B${subtotal}:B${end})`, result: cost.expected }])
  summary.addRows([['Range - low (INR)', cost.total.low], ['Range - high (INR)', cost.total.high], ['INR / sq ft', cost.ratePerSqft], [],
    ['Assumptions'], ...cost.assumptions.map(v => [v]), ['Included'], ...cost.included.map(v => [v]),
    ['Excluded'], ...cost.excluded.map(v => [v]), ['Sources'], ...cost.sources.map(v => [v])])
  summary.getColumn(2).numFmt = money; summary.getColumn(3).numFmt = '0.0%'
  summary.getColumn(4).numFmt = money; summary.getColumn(5).numFmt = money
  decorate(summary, [76, 22, 20, 22, 22, 65], 6)
  for (let r = end + 6; r <= summary.rowCount; r++) { summary.mergeCells(r, 1, r, 6); summary.getRow(r).height = 48 }
  book.calcProperties.fullCalcOnLoad = true
  const bytes = await book.xlsx.writeBuffer()
  return new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
