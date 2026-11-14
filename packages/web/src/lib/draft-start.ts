import { toLocalInput } from './draft'
import { dayKey } from './format'

/**
 * A suggestion sent with a day only (stored as 00:00 Berlin with `times_unverified`). A feed's `times_unverified`
 * means something else: the feed's time stands, the venue page just doesn't confirm it. Mirrors the API's accept.
 */
export function isDayOnly(draft: { times_unverified: boolean }, sourceKind: string): boolean {
  return sourceKind === 'suggestion' && draft.times_unverified
}

/** An inbox draft's start as form values; a day-only suggestion keeps its Berlin day and no time. */
export function draftStartFields(
  draft: { starts_at: string; times_unverified: boolean },
  sourceKind: string,
): { date: string; time: string } {
  if (isDayOnly(draft, sourceKind)) return { date: dayKey(draft.starts_at), time: '' }
  const [date = '', time = ''] = toLocalInput(draft.starts_at).split('T')
  return { date, time }
}
