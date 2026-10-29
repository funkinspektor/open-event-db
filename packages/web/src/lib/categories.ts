import { EVENT_CATEGORIES, type EventCategory } from '@open-event-db/shared'

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  concert: 'Concert',
  party: 'Party',
}

/** "Concert", "Party", "Concert + Party"; null without a category. */
export function categoryLabel(categories: readonly EventCategory[]): string | null {
  const known = EVENT_CATEGORIES.filter((c) => categories.includes(c))
  return known.length ? known.map((c) => CATEGORY_LABELS[c]).join(' + ') : null
}

/** Comma-separated query value → known categories, unknown ones dropped. */
export function parseCategories(raw: string | undefined): EventCategory[] {
  const parts = (raw ?? '').split(',').map((c) => c.trim())
  return EVENT_CATEGORIES.filter((c) => parts.includes(c))
}
