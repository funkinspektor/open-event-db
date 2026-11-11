const MAX_HANDLE = 40

/** Suggests an account handle from a display name: lowercase slug, umlauts transliterated, max 40 chars. */
export function handleFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, MAX_HANDLE)
    .replace(/-+$/, '')
  return slug || 'user'
}
