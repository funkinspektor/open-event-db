import { describe, expect, it } from 'vitest'
import type { AccountMe } from '@open-event-db/shared'
import { canSuggestEvents } from './permissions'

const me = (over: Partial<AccountMe>) => ({ onboarded: true, is_scout: false, organizers: [], ...over }) as AccountMe
const org = (verified: boolean) => ({ id: 'o', name: 'O', slug: 'o', verified }) as AccountMe['organizers'][number]

describe('canSuggestEvents', () => {
  it('is true for a plain onboarded account', () => {
    expect(canSuggestEvents(me({}))).toBe(true)
  })
  it('is true for a member of an unverified organizer only', () => {
    expect(canSuggestEvents(me({ organizers: [org(false)] }))).toBe(true)
  })
  it('is false for a scout', () => {
    expect(canSuggestEvents(me({ is_scout: true }))).toBe(false)
  })
  it('is false for a member of a verified organizer', () => {
    expect(canSuggestEvents(me({ organizers: [org(true)] }))).toBe(false)
  })
  it('is false when not onboarded', () => {
    expect(canSuggestEvents(me({ onboarded: false }))).toBe(false)
  })
  it('is false for null', () => {
    expect(canSuggestEvents(null)).toBe(false)
  })
})
