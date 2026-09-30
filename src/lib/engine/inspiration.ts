import { parseInspirationPreferences, type InspirationPreferences } from './designDna.ts'

/** The image contributes design preferences; it never supplies plan geometry. */
export async function analyzeInspiration(dataUrl: string): Promise<InspirationPreferences> {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/)
  if (!match) throw new Error('Choose a PNG, JPEG or WebP image.')
  const response = await fetch('/api/inspiration', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mimeType: match[1], imageBase64: match[2] }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error || 'Could not analyze the inspiration image.')
  const preferences = parseInspirationPreferences(payload?.preferences)
  if (!preferences?.styleFamily) throw new Error('The image analysis did not return a usable villa style.')
  return preferences
}
