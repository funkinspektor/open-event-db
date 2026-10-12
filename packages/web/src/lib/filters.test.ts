import { describe, expect, it } from 'vitest'
import { customRangeToDates, filtersToHref, parseFilters, rangeToDates } from './filters'

// October 2026, Berlin is on CEST (UTC+2): Fri 16th 00:00 = 2026-10-15T22:00Z, Mon 19th 00:00 = 2026-10-18T22:00Z
const FRIDAY = '2026-10-15T22:00:00.000Z'
const MONDAY = '2026-10-18T22:00:00.000Z'

describe('rangeToDates: weekend', () => {
  it('on a weekday, covers the coming Friday to Monday', () => {
    const { from, to } = rangeToDates('weekend', new Date('2026-10-14T10:00:00Z')) // Wed
    expect(from?.toISOString()).toBe(FRIDAY)
    expect(to?.toISOString()).toBe(MONDAY)
  })

  it('on Saturday, covers the current weekend from now', () => {
    const now = new Date('2026-10-17T12:00:00Z')
    const { from, to } = rangeToDates('weekend', now)
    expect(from?.toISOString()).toBe(now.toISOString())
    expect(to?.toISOString()).toBe(MONDAY)
  })

  it('on Sunday, covers the current weekend from now', () => {
    const now = new Date('2026-10-18T12:00:00Z')
    const { from, to } = rangeToDates('weekend', now)
    expect(from?.toISOString()).toBe(now.toISOString())
    expect(to?.toISOString()).toBe(MONDAY)
  })
})

describe('custom date range', () => {
  it('parses ?from/&to as a custom range and swaps reversed dates', () => {
    expect(parseFilters({ from: '2026-10-19', to: '2026-10-16' })).toMatchObject({
      range: 'custom',
      from: '2026-10-16',
      to: '2026-10-19',
    })
  })

  it('ignores invalid dates and falls back to the preset range', () => {
    expect(parseFilters({ from: 'tomorrow', range: 'week' })).toMatchObject({ range: 'week' })
    expect(parseFilters({ from: 'tomorrow', range: 'week' }).from).toBeUndefined()
  })

  it('keeps the custom range in the URL instead of a preset', () => {
    expect(filtersToHref({ range: 'custom', from: '2026-10-16', to: '2026-10-19', tags: [], city: 'Berlin' })).toBe(
      '/?from=2026-10-16&to=2026-10-19',
    )
  })

  it('covers whole Berlin days, with the end day inclusive', () => {
    // CEST (UTC+2): 16 Oct 00:00 = 15 Oct 22:00Z; the day after 19 Oct starts 19 Oct 22:00Z
    const { from, to } = customRangeToDates('2026-10-16', '2026-10-19')
    expect(from.toISOString()).toBe('2026-10-15T22:00:00.000Z')
    expect(to?.toISOString()).toBe('2026-10-19T22:00:00.000Z')
  })

  it('handles the DST switch (25 Oct 2026, CEST → CET)', () => {
    const { from, to } = customRangeToDates('2026-10-25', '2026-10-25')
    expect(from.toISOString()).toBe('2026-10-24T22:00:00.000Z')
    expect(to?.toISOString()).toBe('2026-10-25T23:00:00.000Z')
  })

  it('starts now when only an end day is given', () => {
    const now = new Date('2026-10-14T10:00:00Z')
    expect(customRangeToDates(undefined, '2026-10-19', now).from).toBe(now)
  })
})
