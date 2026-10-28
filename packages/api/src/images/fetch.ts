import { isIP } from 'node:net'
import { EVENT_IMAGE_MAX_BYTES } from '@open-event-db/shared'
import { sniffImageType, type ImageType } from './sniff.js'

const FETCH_TIMEOUT_MS = 15_000
const USER_AGENT = 'Kellerkompass-Ingest (+https://kellerkompass.de)'

/**
 * Loopback, private, link-local (cloud metadata) and unique-local addresses written as literals. A feed is
 * third-party content, so its image URLs must not make the server fetch from its own network. (A public
 * name that resolves to such an address is not caught; the answer is only stored if it is an image.)
 */
function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const version = isIP(host)
  if (version === 4) {
    const [a, b] = host.split('.').map(Number) as [number, number]
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  if (version === 6) return host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:')
  return false
}

/** A feed's image, checked by signature and size; null for anything that is not a usable image. */
export async function fetchRemoteImage(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ data: Buffer; type: ImageType } | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || isLocalHost(parsed.hostname)) return null

  try {
    const res = await fetchImpl(parsed, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok || !res.body) return null
    // Read up to the limit only: a feed can point at a huge file.
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > EVENT_IMAGE_MAX_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const data = Buffer.concat(chunks)
    const type = sniffImageType(data)
    return type ? { data, type } : null
  } catch {
    return null
  }
}
