import type { EventSlim } from '@open-event-db/shared'
import { dayKey } from './format'

export interface DayGroup {
  key: string
  first: string
  events: EventSlim[]
}

/**
 * The home list's sections. Events that started before the list's first day but aren't over yet
 * (exhibitions, last night's party) go to "Ongoing" instead of under a day that is already past.
 * `firstDay` is the list's first Berlin day (YYYY-MM-DD); the rest is grouped by start day, in order.
 */
export function groupForList(events: EventSlim[], firstDay: string): { ongoing: EventSlim[]; days: DayGroup[] } {
  const ongoing: EventSlim[] = []
  const days: DayGroup[] = []
  for (const e of events) {
    const key = dayKey(e.starts_at)
    if (key < firstDay) {
      ongoing.push(e)
      continue
    }
    const last = days[days.length - 1]
    if (last?.key === key) last.events.push(e)
    else days.push({ key, first: e.starts_at, events: [e] })
  }
  return { ongoing, days }
}
