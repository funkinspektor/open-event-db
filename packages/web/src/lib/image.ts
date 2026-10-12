import { EXTRACT_MAX_ASPECT, EXTRACT_MAX_BYTES, EXTRACT_MAX_EDGE_PX } from '@open-event-db/shared'

/** Originals can be big (full-page captures, camera photos); only the prepared upload has to fit the API limit. */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024

export class ImageError extends Error {}

async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Older Safari: createImageBitmap can't take every format the <img> element can
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight })
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

function makeCanvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImageError('This browser can’t prepare the image.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  draw(ctx, w, h)
  return canvas
}

/**
 * Turns a photo or screenshot into the upload the API expects: tall captures cropped from the top,
 * then scaled to 1600px on the long edge, re-encoded as JPEG. Re-encoding also converts HEIC wherever
 * the browser can display it (Safari).
 */
export async function prepareImage(file: File): Promise<Blob> {
  const isHeic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
  if (!file.type.startsWith('image/') && !isHeic) throw new ImageError('Please choose an image (PNG, JPEG, WEBP or HEIC).')
  if (file.size > MAX_SOURCE_BYTES) throw new ImageError('This image is too large. Try a screenshot of the relevant part.')

  let source: Awaited<ReturnType<typeof decode>>
  try {
    source = await decode(file)
  } catch {
    throw new ImageError(
      isHeic
        ? 'This browser can’t read HEIC photos. Export the photo as JPEG or take a screenshot of it, then try again.'
        : 'This image can’t be read. Try a PNG, JPEG or WEBP file.',
    )
  }

  const { width } = source
  const height = Math.min(source.height, Math.round(width * EXTRACT_MAX_ASPECT))
  const scale = Math.min(1, EXTRACT_MAX_EDGE_PX / Math.max(width, height))
  const target = { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) }

  // Crop onto a white canvas (transparent PNGs would turn black as JPEG) at no more than twice the
  // target size — iOS Safari refuses canvases above ~16.7 megapixels, and phone photos are 48 …
  const first = Math.min(1, (2 * target.w) / width)
  let canvas = makeCanvas(Math.round(width * first), Math.round(height * first), (ctx, w, h) => {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(source, 0, 0, width, height, 0, 0, w, h)
  })
  if ('close' in source && typeof source.close === 'function') source.close()
  // … then halve step by step: one big drawImage jump blurs small print, which the model then misreads
  while (canvas.width / 2 >= target.w) {
    const prev = canvas
    canvas = makeCanvas(Math.round(prev.width / 2), Math.round(prev.height / 2), (ctx, w, h) => ctx.drawImage(prev, 0, 0, w, h))
  }
  if (canvas.width !== target.w) {
    const prev = canvas
    canvas = makeCanvas(target.w, target.h, (ctx, w, h) => ctx.drawImage(prev, 0, 0, w, h))
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new ImageError('This browser can’t prepare the image.')
  if (blob.size > EXTRACT_MAX_BYTES) throw new ImageError('This image is too large after resizing.')
  return blob
}
