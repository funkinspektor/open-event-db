const MAX_RETURN_TO = 500

/** A same-site path to send the person back to after login, or null. Never lets the link become an open redirect. */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > MAX_RETURN_TO) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  // Control characters (CR/LF, tabs) could split headers, or be stripped by browsers into `//host`.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  return value
}
