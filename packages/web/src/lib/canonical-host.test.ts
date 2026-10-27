import { describe, expect, it } from 'vitest'
import { canonicalHostRedirect } from './canonical-host'

describe('canonicalHostRedirect', () => {
  it('sends www to the bare domain and keeps path and query', () => {
    expect(canonicalHostRedirect('www.kellerkompass.de', '/events/abc', '?tag=techno')).toBe(
      'https://kellerkompass.de/events/abc?tag=techno',
    )
  })

  it('leaves the bare domain and local hosts alone', () => {
    expect(canonicalHostRedirect('kellerkompass.de', '/', '')).toBeNull()
    expect(canonicalHostRedirect('localhost:3000', '/', '')).toBeNull()
    expect(canonicalHostRedirect(null, '/', '')).toBeNull()
  })
})
