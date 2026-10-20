/**
 * 3D WebGL / Canvas / GLTF capture and export helpers.
 */
import type { Object3D } from 'three'
import { saveBlob, saveDataUrl, downloadUrl } from './fileSaver.ts'

export async function captureCanvasPng(
  canvas: HTMLCanvasElement,
  filename: string,
  options: { background?: string } = {}
): Promise<void> {
  const targetName = filename.endsWith('.png') ? filename : `${filename}.png`

  // Create an offscreen canvas to guarantee background fill if transparency is undesirable
  const width = canvas.width
  const height = canvas.height
  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = width
  exportCanvas.height = height
  const ctx = exportCanvas.getContext('2d')
  if (ctx) {
    if (options.background) {
      ctx.fillStyle = options.background
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(canvas, 0, 0)
    await new Promise<void>((resolve) => {
      exportCanvas.toBlob((blob) => {
        if (blob) {
          saveBlob(blob, targetName)
        } else {
          saveDataUrl(exportCanvas.toDataURL('image/png'), targetName)
        }
        resolve()
      }, 'image/png')
    })
  } else {
    saveDataUrl(canvas.toDataURL('image/png'), targetName)
  }
}

export async function exportThreeSceneToGlb(
  root: Object3D,
  filename: string,
  options: { binary?: boolean; onlyVisible?: boolean } = {}
): Promise<void> {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
  const exporter = new GLTFExporter()
  const binary = options.binary ?? true
  const onlyVisible = options.onlyVisible ?? true

  const result = await exporter.parseAsync(root, {
    binary,
    onlyVisible,
    maxTextureSize: 2048,
  })

  const targetName = filename.endsWith('.glb') ? filename : `${filename}.glb`
  if (result instanceof ArrayBuffer) {
    const blob = new Blob([result], { type: 'model/gltf-binary' })
    saveBlob(blob, targetName)
  } else {
    const json = JSON.stringify(result, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    saveBlob(blob, filename.endsWith('.gltf') ? filename : `${filename}.gltf`)
  }
}

export async function downloadPanoramaEquirectangular(url: string, filename: string): Promise<void> {
  const ext = url.split('.').pop()?.split('?')[0] || 'webp'
  const targetName = filename.includes('.') ? filename : `${filename}.${ext}`
  await downloadUrl(url, targetName)
}
