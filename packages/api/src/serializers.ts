export function serializeCoordinates(
  c: readonly number[] | null,
): { lat: number; lng: number } | null {
  if (!c || c.length < 2) return null
  const lng = c[0]
  const lat = c[1]
  if (lng === undefined || lat === undefined) return null
  return { lat, lng }
}
