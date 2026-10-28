/** What the create form knows so far — enough to ask the API for events that may be the same one. */
export interface DuplicateDraft {
  venueId: string | null
  locationText: string | null
  /** ISO with offset, or null while the field is empty */
  startsAt: string | null
  endsAt: string | null
  title: string
}

/**
 * Query for `GET /api/v1/events/duplicates`. Null until there is a start and a place
 * (venue, else location text): the endpoint has nothing to compare before that.
 */
export function duplicateQuery(d: DuplicateDraft): URLSearchParams | null {
  const locationText = d.locationText?.trim()
  if (!d.startsAt || (!d.venueId && !locationText)) return null
  const params = new URLSearchParams()
  if (d.venueId) params.set('venue_id', d.venueId)
  else if (locationText) params.set('location_text', locationText)
  params.set('starts_at', d.startsAt)
  if (d.endsAt) params.set('ends_at', d.endsAt)
  if (d.title.trim()) params.set('title', d.title.trim())
  return params
}
