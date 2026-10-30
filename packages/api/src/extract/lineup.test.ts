import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Lineup } from '@open-event-db/shared'
import { ExtractionError } from './vision.js'
import { LINEUP_SYSTEM_PROMPT, checkAgainstText, lineupReading, scalewayLineup } from './lineup.js'

const act = (name: string, over: Partial<{ time: string | null; live: boolean; note: string | null }> = {}) => ({
  name,
  time: null,
  live: false,
  note: null,
  ...over,
})
const one = (...acts: ReturnType<typeof act>[]): Lineup => [{ name: null, acts }]

afterEach(() => {
  vi.unstubAllGlobals()
  lineupReading.reset()
})

describe('checkAgainstText', () => {
  it('drops an act whose name is not in the text', () => {
    expect(checkAgainstText(one(act('Volcan'), act('Invented Band')), 'Live: Volcan')).toEqual(one(act('Volcan')))
  })

  it('finds names behind Markdown, arrows, other scripts and case changes', () => {
    const text = '**Bragolin**(live)\non decks:\n▷ Uwe Marx\ndj ørlög //\nWhacking by Thomasito x Ai 爱 [Whacking Berlin]'
    const lineup = one(act('Bragolin', { live: true }), act('Uwe Marx'), act('DJ Ørlög'), act('Ai 爱'))
    expect(checkAgainstText(lineup, text)).toEqual(lineup)
  })

  it('matches across collapsed whitespace and line breaks', () => {
    expect(checkAgainstText(one(act('Marko König')), 'DJs: Marko  \nKönig')).toEqual(one(act('Marko König')))
  })

  it('clears a note that is not in the text but keeps the act', () => {
    expect(checkAgainstText(one(act('Hinfort', { note: 'Cold Records' })), 'Hinfort [Young And Cold]')).toEqual(
      one(act('Hinfort')),
    )
    expect(checkAgainstText(one(act('Hinfort', { note: 'Young And Cold' })), 'Hinfort [Young And Cold]')).toEqual(
      one(act('Hinfort', { note: 'Young And Cold' })),
    )
  })

  it('turns a group name that is not in the text into an unnamed group', () => {
    const lineup: Lineup = [{ name: 'Main Floor', acts: [act('Testbild')] }]
    expect(checkAgainstText(lineup, 'Testbild all night')).toEqual(one(act('Testbild')))
  })

  it('drops a group left without acts', () => {
    const lineup: Lineup = [
      { name: 'Live', acts: [act('Nobody Here')] },
      { name: 'DJs', acts: [act('Testbild')] },
    ]
    expect(checkAgainstText(lineup, 'Live: tba\nDJs: Testbild')).toEqual([{ name: 'DJs', acts: [act('Testbild')] }])
  })

  it('returns nothing for an empty lineup', () => {
    expect(checkAgainstText([], 'Anything')).toEqual([])
  })
})

describe('scalewayLineup', () => {
  const reply = (content: unknown) =>
    vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }),
    )

  it('sends the text with the lineup prompt and returns the checked lineup', async () => {
    const fetchMock = reply({
      groups: [{ name: null, acts: [act('Volcan', { live: true }), act('Made Up', { time: '0:30' })] }],
    })
    vi.stubGlobal('fetch', fetchMock)

    const reader = scalewayLineup({ secretKey: 'sk', projectId: 'proj', model: 'text-model' })
    await expect(reader.read('Volcan (live)')).resolves.toEqual(one(act('Volcan', { live: true })))

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
    expect(body.model).toBe('text-model')
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.messages).toEqual([
      { role: 'system', content: LINEUP_SYSTEM_PROMPT },
      { role: 'user', content: 'Volcan (live)' },
    ])
  })

  it('cleans times through sanitizeLineup', async () => {
    vi.stubGlobal('fetch', reply({ groups: [{ name: null, acts: [act('Testbild', { time: '0:30' })] }] }))
    const reader = scalewayLineup({ secretKey: 'sk', projectId: 'proj', model: 'm' })
    await expect(reader.read('0:30 Testbild')).resolves.toEqual(one(act('Testbild', { time: '00:30' })))
  })

  it('reports an answer that is not JSON as invalid output', async () => {
    vi.stubGlobal('fetch', reply('not json'))
    const reader = scalewayLineup({ secretKey: 'sk', projectId: 'proj', model: 'm' })
    await expect(reader.read('x')).rejects.toMatchObject({ kind: 'invalid_output' })
    await expect(reader.read('x')).rejects.toBeInstanceOf(ExtractionError)
  })
})

describe('lineupReading', () => {
  it('is unavailable in tests until a reader is installed', async () => {
    await expect(lineupReading.reader.read('x')).rejects.toMatchObject({ kind: 'unavailable' })
    lineupReading.setReader({ read: async () => one(act('A')) })
    await expect(lineupReading.reader.read('A')).resolves.toEqual(one(act('A')))
  })
})
