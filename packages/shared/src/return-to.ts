const MAX_RETURN_TO = 500

/** A same-site path to send the person back to after login, or null. Never lets the link become an open redirect. */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > MAX_RETURN_TO) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  // Printable ASCII only (callers send percent-encoded paths): anything else can break the Location header
  // (characters above U+00FF throw, Latin-1 bytes go out raw) or be stripped by browsers into `//host`.
  if (!/^[\x21-\x7e]+$/.test(value)) return null
  return value
}
