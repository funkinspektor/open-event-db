import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Extraction } from '@open-event-db/shared'
import { ExtractionError } from './vision.js'
import { TEXT_SYSTEM_PROMPT, scalewayText, textExtraction } from './text.js'

const result: Extraction = {
  title: 'Persian Love',
  date: { day: 30, month: 10, year: null, weekday: 'fri' },
  start_time: '22:00',
  end_date: null,
  end_time: '04:00',
  venue_name: 'ACUD Club',
  address: null,
  city: null,
  description: null,
  lineup: [],
  tags: [],
  links: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
  textExtraction.reset()
})

describe('TEXT_SYSTEM_PROMPT', () => {
  it('is the image prompt reworded for announcement text', () => {
    expect(TEXT_SYSTEM_PROMPT).toMatch(/^You read the text of an event announcement and extract the details of ONE event as JSON\./)
    expect(TEXT_SYSTEM_PROMPT).not.toMatch(/image|address bar/i)
    expect(TEXT_SYSTEM_PROMPT).toContain('start_time, end_time: 24-hour "HH:MM"')
  })
})

describe('scalewayText', () => {
  it('sends the description as the user message and parses the answer', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const extractor = scalewayText({ secretKey: 'sk', projectId: 'proj', model: 'text-model' })
    await expect(extractor.extract('FR 30.10, ACUD CLUB\n10PM- 4AM')).resolves.toEqual(result)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.scaleway.ai/proj/v1/chat/completions')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('text-model')
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.messages).toEqual([
      { role: 'system', content: TEXT_SYSTEM_PROMPT },
      { role: 'user', content: 'FR 30.10, ACUD CLUB\n10PM- 4AM' },
    ])
  })

  it('reports invalid model output as an ExtractionError', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ choices: [{ message: { content: '{"title": 1}' } }] }))
    const extractor = scalewayText({ secretKey: 'sk', projectId: 'proj', model: 'text-model' })
    await expect(extractor.extract('text')).rejects.toMatchObject({ name: 'ExtractionError', kind: 'invalid_output' })
  })
})

describe('textExtraction', () => {
  it('is unavailable in tests until a stub is installed, and reset restores that', async () => {
    await expect(textExtraction.extractor.extract('text')).rejects.toBeInstanceOf(ExtractionError)
    await expect(textExtraction.extractor.extract('text')).rejects.toMatchObject({ kind: 'unavailable' })

    textExtraction.setExtractor({ extract: async () => result })
    await expect(textExtraction.extractor.extract('text')).resolves.toEqual(result)

    textExtraction.reset()
    await expect(textExtraction.extractor.extract('text')).rejects.toMatchObject({ kind: 'unavailable' })
  })
})
