import { describe, expect, it } from 'vitest'
import type { EventSlim } from '@open-event-db/shared'
import { groupForList } from './group'

const ev = (id: string, starts_at: string, ends_at: string | null = null) =>
  ({ id, starts_at, ends_at, start_time_known: true }) as EventSlim

describe('groupForList', () => {
  it('puts events that started before the first day into Ongoing and groups the rest by day', () => {
    const events = [
      ev('exhibition', '2026-11-01T10:00:00Z', '2026-11-30T17:00:00Z'),
      ev('party', '2026-11-04T22:00:00Z'), // 23:00 Berlin on the 4th
      ev('late', '2026-11-04T23:30:00Z'), // 00:30 Berlin on the 5th: today
      ev('tonight', '2026-11-05T19:00:00Z'),
      ev('tomorrow', '2026-11-06T19:00:00Z'),
    ]
    const { ongoing, days } = groupForList(events, '2026-11-05')
    expect(ongoing.map((e) => e.id)).toEqual(['exhibition', 'party'])
    expect(days.map((d) => [d.key, d.events.map((e) => e.id)])).toEqual([
      ['2026-11-05', ['late', 'tonight']],
      ['2026-11-06', ['tomorrow']],
    ])
  })

  it('has no Ongoing section when nothing started earlier', () => {
    expect(groupForList([ev('a', '2026-11-05T19:00:00Z')], '2026-11-05').ongoing).toEqual([])
  })
})
