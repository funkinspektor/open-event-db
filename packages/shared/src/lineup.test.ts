import { describe, expect, it } from 'vitest'
import { capLineup, lineupSchema, type Lineup } from './lineup.js'

const acts = (n: number, prefix = 'Act') => Array.from({ length: n }, (_, i) => ({ name: `${prefix} ${i + 1}` }))

describe('lineupSchema', () => {
  it('accepts set times as listed, after midnight too', () => {
    for (const time of ['23:59', '00:30']) {
      expect(lineupSchema.safeParse([{ acts: [{ name: 'A', time }] }]).success).toBe(true)
    }
  })

  it('rejects times that are not HH:MM on a 24-hour clock', () => {
    for (const time of ['24:00', '7:00']) {
      expect(lineupSchema.safeParse([{ acts: [{ name: 'A', time }] }]).success).toBe(false)
    }
  })

  it('fills in the optional fields', () => {
    expect(lineupSchema.parse([{ acts: [{ name: 'A' }] }])).toEqual([
      { name: null, acts: [{ name: 'A', time: null, live: false, note: null }] },
    ])
  })

  it('trims names and rejects empty ones', () => {
    expect(lineupSchema.parse([{ acts: [{ name: '  Surgeon ' }] }])[0]!.acts[0]!.name).toBe('Surgeon')
    expect(lineupSchema.safeParse([{ acts: [{ name: '  ' }] }]).success).toBe(false)
  })

  it('allows at most 20 groups', () => {
    const groups = Array.from({ length: 21 }, () => ({ acts: [{ name: 'A' }] }))
    expect(lineupSchema.safeParse(groups).success).toBe(false)
  })

  it('allows at most 200 acts across all groups', () => {
    const result = lineupSchema.safeParse([{ acts: acts(100) }, { acts: acts(101) }])
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/200/)
  })
})

describe('capLineup', () => {
  const group = (name: string, n: number) => ({ name, acts: lineupSchema.parse([{ acts: acts(n, name) }])[0]!.acts })

  it('keeps the first 200 acts in order', () => {
    const capped = capLineup([group('A', 100), group('B', 100), group('C', 100)])
    expect(capped.map((g) => g.name)).toEqual(['A', 'B'])
    expect(capped.flatMap((g) => g.acts)).toHaveLength(200)
    expect(lineupSchema.safeParse(capped).success).toBe(true)
  })

  it('cuts a group in the middle and drops the empty rest', () => {
    const capped = capLineup([group('A', 150), group('B', 100)])
    expect(capped.map((g) => [g.name, g.acts.length])).toEqual([
      ['A', 150],
      ['B', 50],
    ])
  })

  it('keeps the first 20 groups', () => {
    const lineup: Lineup = Array.from({ length: 25 }, (_, i) => group(`G${i}`, 1))
    expect(capLineup(lineup)).toHaveLength(20)
  })
})
