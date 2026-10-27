// The site lives on the bare domain; www.kellerkompass.de is only an alias that should land there.
// Returns the URL to redirect to, or null when the request already uses the canonical host.
export function canonicalHostRedirect(host: string | null, pathname: string, search: string): string | null {
  if (!host?.startsWith('www.')) return null
  return `https://${host.slice(4)}${pathname}${search}`
}
