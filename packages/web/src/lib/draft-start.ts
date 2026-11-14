import { toLocalInput } from './draft'
import { dayKey } from './format'

/** An inbox draft's start as form values; a day-only draft (`times_unverified`) keeps its Berlin day and no time. */
export function draftStartFields(draft: { starts_at: string; times_unverified: boolean }): { date: string; time: string } {
  if (draft.times_unverified) return { date: dayKey(draft.starts_at), time: '' }
  const [date = '', time = ''] = toLocalInput(draft.starts_at).split('T')
  return { date, time }
}
