/**
 * Safe client-side file saver utilities.
 */

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a)
    URL.revokeObjectURL(url)
  }, 4000)
}

export function saveDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a)
  }, 4000)
}

export async function downloadUrl(url: string, filename: string): Promise<void> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`)
    const blob = await res.blob()
    saveBlob(blob, filename)
  } catch {
    // Fallback: direct download link
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a)
    }, 4000)
  }
}
