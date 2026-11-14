import { eventDaySchema, type IngestDraft, type SuggestionCreateInput } from '@open-event-db/shared'
import { berlinInstant } from '../extract/normalize.js'
import { calendarDay } from '../ingest/normalize.js'

/** `starts_at` of a suggestion: a timestamp, or a bare day (00:00 Berlin) when the start time isn't known. */
export function suggestionStart(value: string): { startsAt: Date; startTimeKnown: boolean } {
  if (!eventDaySchema.safeParse(value).success) return { startsAt: new Date(value), startTimeKnown: true }
  return { startsAt: berlinInstant(calendarDay(value), 0), startTimeKnown: false }
}

/** The inbox draft of a person's suggestion. `venueCity` wins over the sent city. */
export function toSuggestionDraft(input: SuggestionCreateInput, venueCity: string | null): IngestDraft {
  const { startsAt, startTimeKnown } = suggestionStart(input.starts_at)
  return {
    title: input.title,
    description: input.description ?? '',
    lineup: input.lineup ?? [],
    starts_at: startsAt.toISOString(),
    ends_at: input.ends_at ? new Date(input.ends_at).toISOString() : null,
    venue_id: input.venue_id ?? null,
    location_text: input.location_text ?? null,
    city: venueCity ?? input.city ?? '',
    categories: input.categories ?? [],
    links: input.links ?? {},
    image_url: null,
    // The first link stands in for a feed item's page ("Original" in the inbox)
    source_url: Object.values(input.links ?? {})[0] ?? null,
    times_unverified: !startTimeKnown,
    lineup_from_text: false,
  }
}
