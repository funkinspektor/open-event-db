import { describe, expect, it } from 'vitest'
import { rangeToDates } from './filters'

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
