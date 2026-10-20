/**
 * Enhanced 2D SVG & High-DPI rasterization export helpers.
 * Injects explicit backgrounds and required XML namespaces to avoid transparent or black renders in third-party viewers.
 */
import { saveBlob } from './fileSaver.ts'

export interface SvgExportOptions {
  background?: string
  width?: number
  height?: number
  scale?: number
  title?: string
}

export function prepareSvgForExport(svg: SVGSVGElement, options: SvgExportOptions = {}): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')

  // Derive viewBox coordinates
  const viewBox = svg.viewBox?.baseVal
  const vbX = viewBox && viewBox.width > 0 ? viewBox.x : 0
  const vbY = viewBox && viewBox.height > 0 ? viewBox.y : 0
  const vbW = viewBox && viewBox.width > 0 ? viewBox.width : (svg.clientWidth || 1000)
  const vbH = viewBox && viewBox.height > 0 ? viewBox.height : (svg.clientHeight || 750)

  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`)
  }

  const exportW = options.width ?? (vbW > vbH ? 1800 : Math.round(1800 * (vbW / vbH)))
  const exportH = options.height ?? Math.round(exportW * (vbH / vbW))

  clone.setAttribute('width', String(exportW))
  clone.setAttribute('height', String(exportH))

  // Inject explicit solid background rect to ensure SVG does not render transparent or black in desktop viewers
  const bg = options.background ?? '#ffffff'
  if (bg && bg !== 'transparent') {
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bgRect.setAttribute('x', String(vbX))
    bgRect.setAttribute('y', String(vbY))
    bgRect.setAttribute('width', String(vbW))
    bgRect.setAttribute('height', String(vbH))
    bgRect.setAttribute('fill', bg)
    clone.insertBefore(bgRect, clone.firstChild)
  }

  // Ensure default inline typography style
  const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  styleEl.textContent = `
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, monospace; }
  `
  clone.insertBefore(styleEl, clone.firstChild)

  if (options.title) {
    const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    titleEl.textContent = options.title
    clone.insertBefore(titleEl, clone.firstChild)
  }

  return clone
}

export function serializeSvg(svg: SVGSVGElement, options: SvgExportOptions = {}): string {
  const prepared = prepareSvgForExport(svg, options)
  return new XMLSerializer().serializeToString(prepared)
}

export function downloadSvg(svg: SVGSVGElement, filename: string, options: SvgExportOptions = {}): void {
  const xml = serializeSvg(svg, options)
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  saveBlob(blob, filename.endsWith('.svg') ? filename : `${filename}.svg`)
}

export async function downloadSvgAsPng(
  svg: SVGSVGElement,
  filename: string,
  options: SvgExportOptions = {}
): Promise<void> {
  const scale = options.scale ?? 2 // High-DPI 2x
  const xml = serializeSvg(svg, options)
  const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`

  const img = new Image()
  img.decoding = 'sync'
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SVG image load timed out')), 8000)
    img.onload = () => {
      clearTimeout(timer)
      resolve()
    }
    img.onerror = () => {
      clearTimeout(timer)
      reject(new Error('Failed to load SVG for rasterization'))
    }
    img.src = dataUri
  })

  const viewBox = svg.viewBox?.baseVal
  const baseW = (viewBox && viewBox.width > 0 ? viewBox.width : (svg.clientWidth || 1000))
  const baseH = (viewBox && viewBox.height > 0 ? viewBox.height : (svg.clientHeight || 750))
  const targetW = Math.round((options.width ?? (baseW > baseH ? 1800 : Math.round(1800 * (baseW / baseH)))) * scale)
  const targetH = Math.round(targetW * (baseH / baseW))

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  ctx.fillStyle = options.background ?? '#ffffff'
  ctx.fillRect(0, 0, targetW, targetH)
  ctx.drawImage(img, 0, 0, targetW, targetH)

  await new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Canvas toBlob failed'))
      saveBlob(blob, filename.endsWith('.png') ? filename : `${filename}.png`)
      resolve()
    }, 'image/png')
  })
}
