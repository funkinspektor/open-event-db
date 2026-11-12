import { isIPv6 } from 'node:net'

/**
 * The key per-IP limits use for a client address. IPv4 stays as is, an IPv4-mapped IPv6 address
 * (`::ffff:1.2.3.4`) becomes its IPv4 address, and any other IPv6 address becomes its /64 prefix: one
 * customer usually gets a whole /64, so keying per address would give them 2^64 buckets.
 */
export function ipKey(ip: string): string {
  const addr = ip.split('%')[0]!.trim()
  if (!isIPv6(addr)) return addr
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(addr)
  if (mapped) return mapped[1]!

  // Turn a dotted IPv4 tail into two hextets, then expand `::`
  let text = addr.toLowerCase()
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number]
    text = text.slice(0, tail.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const [head = '', rest] = text.split('::')
  const headParts = head ? head.split(':') : []
  const restParts = rest === undefined ? [] : rest ? rest.split(':') : []
  const fill = rest === undefined ? 0 : 8 - headParts.length - restParts.length
  const groups = [...headParts, ...Array<string>(Math.max(fill, 0)).fill('0'), ...restParts]
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':') + '::/64'
}
