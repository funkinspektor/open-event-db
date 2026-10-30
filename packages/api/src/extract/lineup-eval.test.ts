import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { lineupSchema, type Lineup } from '@open-event-db/shared'
import { checkAgainstText } from './lineup.js'
import { scoreCase } from './lineup-eval.js'

const lineup = (...acts: [name: string, live?: boolean][]): Lineup => [
  { name: null, acts: acts.map(([name, live = false]) => ({ name, time: null, live, note: null })) },
]

describe('cases.json', () => {
  const cases = JSON.parse(readFileSync(fileURLToPath(new URL('./lineup-eval/cases.json', import.meta.url)), 'utf8')) as {
    id: string
    text: string
    expected: Lineup
  }[]

  it.each(cases.map((c) => [c.id, c] as const))('%s expects only acts the name check keeps', (_, c) => {
    expect(lineupSchema.parse(c.expected)).toEqual(c.expected)
    expect(checkAgainstText(c.expected, c.text)).toEqual(c.expected)
  })
})

describe('scoreCase', () => {
  it('counts a perfect match', () => {
    expect(scoreCase(lineup(['Volcan', true], ['Dardo']), lineup(['volcan', true], ['DARDO']))).toEqual({
      expected: 2,
      found: 2,
      returned: 2,
      correct: 2,
      liveRight: 2,
    })
  })

  it('counts a missed act', () => {
    expect(scoreCase(lineup(['Volcan'], ['Dardo']), lineup(['Volcan']))).toMatchObject({ expected: 2, found: 1, returned: 1, correct: 1 })
  })

  it('counts an extra act', () => {
    expect(scoreCase(lineup(['Volcan']), lineup(['Volcan'], ['Factory DJs']))).toMatchObject({ found: 1, returned: 2, correct: 1 })
  })

  it('counts a wrong live flag', () => {
    expect(scoreCase(lineup(['Volcan', true]), lineup(['Volcan', false]))).toMatchObject({ found: 1, liveRight: 0 })
  })

  it('ignores groups when matching acts', () => {
    const grouped: Lineup = [{ name: 'Live', acts: [{ name: 'Volcan', time: null, live: true, note: null }] }]
    expect(scoreCase(grouped, lineup(['Volcan', true]))).toMatchObject({ found: 1, correct: 1, liveRight: 1 })
  })

  it('scores an expected-empty case with an empty answer as nothing missed and nothing extra', () => {
    expect(scoreCase([], [])).toEqual({ expected: 0, found: 0, returned: 0, correct: 0, liveRight: 0 })
  })
})
