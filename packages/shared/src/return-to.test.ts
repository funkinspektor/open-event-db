import { describe, expect, it } from 'vitest'
import { safeReturnTo } from './return-to.js'

describe('safeReturnTo', () => {
  it('keeps same-site paths', () => expect(safeReturnTo('/events/x?interest=1')).toBe('/events/x?interest=1'))
  it.each(['//evil.example', 'https://evil.example', '/\\evil', 'events', '/a\\b', `/${'a'.repeat(500)}`, '/a\nb', '/events/€', '/events/ü', '/events/😀', 42, null, undefined, ''])(
    'drops %j',
    (v) => expect(safeReturnTo(v)).toBeNull(),
  )
  it('keeps percent-encoded paths', () => expect(safeReturnTo('/events/%E2%82%AC')).toBe('/events/%E2%82%AC'))
  it('accepts exactly 500 chars', () => {
    const p = `/${'a'.repeat(499)}`
    expect(safeReturnTo(p)).toBe(p)
  })
})
