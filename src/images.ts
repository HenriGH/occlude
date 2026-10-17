import type { Asset } from './domain'

export const MAX_FILE_BYTES = 15 * 1024 * 1024
const MAX_PIXELS = 20_000_000

export async function prepareImage(file: Blob): Promise<Asset> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Bitte ein PNG-, JPEG- oder WebP-Bild verwenden.')
  if (file.size > MAX_FILE_BYTES) throw new Error('Das Bild ist zu groß. Maximal 15 MB sind möglich.')
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('Das Bild konnte nicht geöffnet werden. Bitte eine gültige PNG-, JPEG- oder WebP-Datei verwenden.') })
  try {
    if (bitmap.width * bitmap.height > MAX_PIXELS || bitmap.width > 12000 || bitmap.height > 12000)
      throw new Error('Das Bild ist zu groß. Maximal 20 Megapixel und 12.000 Pixel pro Seite sind möglich.')
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Die Bildverarbeitung ist in diesem Browser nicht verfügbar.')
    ctx.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Das Bild konnte nicht verarbeitet werden.')), 'image/webp', 0.96))
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
    return { hash, blob, width: bitmap.width, height: bitmap.height, mimeType: blob.type }
  } finally { bitmap.close() }
}
