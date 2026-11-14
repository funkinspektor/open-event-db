// Event images are stored as uploaded (often 0.5–1 MB) but mostly shown small. Next's image optimizer
// (`/_next/image`) resizes them on first request, re-encodes them as WebP and caches the result.
// It only accepts the hosts in next.config.mjs (`KK_IMAGE_HOSTS`); other URLs stay untouched.

const HOSTS = new Set((process.env.KK_IMAGE_HOSTS ?? '').split(',').filter(Boolean))
const QUALITY = 75

function optimizable(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

/** One resized variant. `width` must be one of Next's image or device sizes (e.g. 128, 256, 384, 640, 1080, 1920). */
export function resized(url: string, width: number): string {
  return optimizable(url) ? `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=${QUALITY}` : url
}

/** `src`/`srcSet` for a thumbnail drawn `width` CSS pixels wide, for screens at 1x, 2x and 3x. */
export function thumbnailProps(url: string, widths: readonly [number, number, number]) {
  if (!optimizable(url)) return { src: url }
  const [x1, x2, x3] = widths
  return {
    src: resized(url, x2),
    srcSet: `${resized(url, x1)} 1x, ${resized(url, x2)} 2x, ${resized(url, x3)} 3x`,
  }
}

/** `src`/`srcSet`/`sizes` for an image that fills its column. */
export function responsiveImageProps(url: string, sizes: string) {
  if (!optimizable(url)) return { src: url }
  return {
    src: resized(url, 1080),
    srcSet: [640, 1080, 1920].map((w) => `${resized(url, w)} ${w}w`).join(', '),
    sizes,
  }
}
