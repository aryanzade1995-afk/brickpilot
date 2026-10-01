/** Export the current rendered sheet, including its selected theme and layers. */
export function sheetSvg(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true) as SVGSVGElement
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const box = svg.viewBox.baseVal
  copy.setAttribute('width', '1800')
  copy.setAttribute('height', String(Math.round(1800 * box.height / box.width)))
  return new XMLSerializer().serializeToString(copy)
}

export function downloadSheetSvg(svg: SVGSVGElement, name: string) {
  const url = URL.createObjectURL(new Blob([sheetSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = `${name}.svg`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadSheetPdf(svg: SVGSVGElement, name: string) {
  const { jsPDF } = await import('jspdf')
  const url = URL.createObjectURL(new Blob([sheetSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Drawing export is unavailable in this browser.')
    context.drawImage(image, 0, 0)
    const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? 'landscape' : 'portrait', unit: 'mm', format: 'a3' })
    const w = pdf.internal.pageSize.getWidth() - 20, h = pdf.internal.pageSize.getHeight() - 20
    const scale = Math.min(w / canvas.width, h / canvas.height)
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10 + (w - canvas.width * scale) / 2,
      10 + (h - canvas.height * scale) / 2, canvas.width * scale, canvas.height * scale)
    pdf.save(`${name}.pdf`)
  } finally { URL.revokeObjectURL(url) }
}
