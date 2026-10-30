import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { inArray } from 'drizzle-orm'
import { generateApiKey, publishers, type Publisher } from '@open-event-db/db'
import { EXTRACT_DAILY_LIMIT, EXTRACT_MAX_IMAGES, type Extraction, type Lineup } from '@open-event-db/shared'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { lineupReading } from '../extract/lineup.js'
import { ExtractionError, vision, type ExtractImage } from '../extract/vision.js'

let app: FastifyInstance
const created: Publisher[] = []
const keys: Record<'publisher' | 'scout' | 'limited', string> = { publisher: '', scout: '', limited: '' }
const stamp = Date.now()

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32)])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)])
const MiB = 1024 * 1024

const extraction: Extraction = {
  title: 'Keller Nacht',
  date: { day: 17, month: 10, year: 2099, weekday: null },
  start_time: '23:00',
  end_date: null,
  end_time: '06:00',
  venue_name: 'Halle 4',
  address: null,
  city: null,
  description: 'Eine lange Nacht.',
  lineup: ['DJ A'],
  categories: ['party'],
  tags: ['Techno'],
  links: [{ kind: 'instagram', url: '@keller' }],
}

/** One entry per extractor call: the images of that request. */
let received: ExtractImage[][] = []
const stub = (result: () => Promise<Extraction>) =>
  vision.setExtractor({
    async extract(images) {
      received.push(images)
      return result()
    },
  })

const post = (key: string | null, payload: Buffer | string, contentType = 'image/png') =>
  app.inject({
    method: 'POST',
    url: '/api/v1/events/extract',
    headers: { 'content-type': contentType, ...(key ? { authorization: `Bearer ${key}` } : {}) },
    payload,
  })

/** Multipart body with one part per entry; strings become text parts. */
async function multipart(parts: [name: string, value: Buffer | string][]) {
  const form = new FormData()
  for (const [name, value] of parts) {
    if (typeof value === 'string') form.append(name, value)
    else form.append(name, new Blob([value]), 'image')
  }
  const res = new Response(form)
  return { payload: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type')! }
}

const postParts = async (key: string | null, parts: [string, Buffer | string][]) => {
  const { payload, contentType } = await multipart(parts)
  return post(key, payload, contentType)
}

beforeAll(async () => {
  app = await buildApp({ logger: false })
  const k = { publisher: generateApiKey(), scout: generateApiKey(), limited: generateApiKey() }
  for (const [role, { key }] of Object.entries(k)) keys[role as keyof typeof keys] = key
  created.push(
    ...(await db
      .insert(publishers)
      .values([
        { name: 'Extract Pub', slug: `extract-pub-${stamp}`, email: `extract-pub-${stamp}@test.local`, verified: true, apiKeyHash: k.publisher.hash },
        { name: 'Extract Scout', slug: `extract-scout-${stamp}`, email: `extract-scout-${stamp}@test.local`, verified: true, isPublisher: false, isScout: true, apiKeyHash: k.scout.hash },
        { name: 'Extract Limited', slug: `extract-limited-${stamp}`, email: `extract-limited-${stamp}@test.local`, verified: true, apiKeyHash: k.limited.hash },
      ])
      .returning()),
  )
})

beforeEach(() => {
  received = []
  stub(async () => extraction)
})

afterAll(async () => {
  vision.reset()
  await db.delete(publishers).where(inArray(publishers.id, created.map((p) => p.id)))
  await app.close()
})

describe('POST /events/extract', () => {
  it('requires authentication', async () => {
    const res = await post(null, PNG)
    expect(res.statusCode).toBe(401)
    expect(received).toHaveLength(0)
  })

  it('returns a normalized draft to publishers and scouts', async () => {
    for (const key of [keys.publisher, keys.scout]) {
      const res = await post(key, PNG)
      expect(res.statusCode).toBe(200)
      expect(res.json().data).toEqual({
        title: 'Keller Nacht',
        start_date: '2099-10-17',
        starts_at: '2099-10-17T23:00:00+02:00',
        ends_at: '2099-10-18T06:00:00+02:00',
        venue_name: 'Halle 4',
        address: null,
        city: 'Berlin',
        description: 'Eine lange Nacht.',
        lineup: ['DJ A'],
        categories: ['party'],
        tags: ['techno'],
        links: { instagram: 'https://www.instagram.com/keller' },
      })
    }
  })

  it('passes the sniffed image type, not the claimed one', async () => {
    await post(keys.publisher, WEBP, 'image/png')
    expect(received[0]?.[0]?.type).toBe('image/webp')
  })

  it('rejects bodies that are not images', async () => {
    expect((await post(keys.publisher, Buffer.from('not an image at all'))).statusCode).toBe(415)
    const json = await post(keys.publisher, JSON.stringify({ hello: 'world' }), 'application/json')
    expect(json.statusCode).toBe(415)
    expect(json.json().error.code).toBe('unsupported_media_type')
    expect(received).toHaveLength(0)
  })

  it('rejects bodies over 6 MiB', async () => {
    const res = await post(keys.publisher, Buffer.concat([PNG, Buffer.alloc(6 * MiB)]))
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('payload_too_large')
  })

  describe('multipart', () => {
    it('sends all images to the model in one call, in order', async () => {
      const res = await postParts(keys.publisher, [['image', PNG], ['image', JPEG], ['image', WEBP]])
      expect(res.statusCode).toBe(200)
      expect(res.json().data.title).toBe('Keller Nacht')
      expect(received).toHaveLength(1)
      expect(received[0]!.map((i) => i.type)).toEqual(['image/png', 'image/jpeg', 'image/webp'])
    })

    it('accepts a single image', async () => {
      expect((await postParts(keys.publisher, [['image', JPEG]])).statusCode).toBe(200)
      expect(received[0]).toHaveLength(1)
    })

    it(`allows ${EXTRACT_MAX_IMAGES} images, not more`, async () => {
      const ok = await postParts(keys.publisher, Array.from({ length: EXTRACT_MAX_IMAGES }, () => ['image', JPEG]))
      expect(ok.statusCode).toBe(200)
      const tooMany = await postParts(keys.publisher, Array.from({ length: EXTRACT_MAX_IMAGES + 1 }, () => ['image', JPEG]))
      expect(tooMany.statusCode).toBe(400)
      expect(tooMany.json().error.code).toBe('too_many_images')
      expect(received).toHaveLength(1)
    })

    it('checks every part by its signature', async () => {
      const res = await postParts(keys.publisher, [['image', PNG], ['image', Buffer.from('not an image at all')]])
      expect(res.statusCode).toBe(415)
      expect(res.json().error.code).toBe('unsupported_media_type')
      expect(received).toHaveLength(0)
    })

    it('needs at least one part named image', async () => {
      const res = await postParts(keys.publisher, [['file', PNG], ['note', 'hello']])
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('no_images')
    })

    it('rejects text parts named image', async () => {
      expect((await postParts(keys.publisher, [['image', 'hello']])).statusCode).toBe(415)
    })

    it('limits the whole body to 6 MiB', async () => {
      const big = Buffer.concat([JPEG, Buffer.alloc(2 * MiB)])
      const res = await postParts(keys.publisher, [['image', big], ['image', big], ['image', big]])
      expect(res.statusCode).toBe(413)
      expect(res.json().error.code).toBe('payload_too_large')
      expect(received).toHaveLength(0)
    })

    it('rejects a malformed body', async () => {
      const res = await post(keys.publisher, 'garbage', 'multipart/form-data; boundary=xyz')
      expect(res.statusCode).toBe(400)
      expect(received).toHaveLength(0)
    })

    it('needs authentication', async () => {
      expect((await postParts(null, [['image', PNG]])).statusCode).toBe(401)
    })

    it('counts as one extraction against the daily limit', async () => {
      const parts = Array.from({ length: 4 }, () => ['image', JPEG] as [string, Buffer])
      const remaining = async () => Number((await postParts(keys.scout, parts)).headers['x-ratelimit-remaining'])
      const first = await remaining()
      expect(await remaining()).toBe(first - 1)
    })
  })

  it.each([
    ['unavailable', 503, 'extraction_unavailable'],
    ['timeout', 504, 'extraction_timeout'],
    ['provider', 502, 'extraction_provider_error'],
    ['invalid_output', 422, 'extraction_failed'],
  ] as const)('maps a %s failure to %i', async (kind, status, code) => {
    stub(async () => {
      throw new ExtractionError(kind, 'secret provider detail')
    })
    const res = await post(keys.publisher, PNG)
    expect(res.statusCode).toBe(status)
    expect(res.json().error.code).toBe(code)
    expect(res.body).not.toContain('secret provider detail')
  })

  it('reports an image without event details', async () => {
    stub(async () => ({ ...extraction, title: null, date: null, venue_name: null, description: null, lineup: [] }))
    const res = await post(keys.publisher, PNG)
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('nothing_extracted')
  })

  it(`allows ${EXTRACT_DAILY_LIMIT} extractions per account per day`, async () => {
    for (let i = 0; i < EXTRACT_DAILY_LIMIT; i++) {
      expect((await post(keys.limited, PNG)).statusCode).toBe(200)
    }
    const res = await post(keys.limited, PNG)
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe('rate_limited')
    // Other accounts keep their own counter
    expect((await post(keys.scout, PNG)).statusCode).toBe(200)
  })
})

describe('POST /events/extract-lineup', () => {
  const lineup: Lineup = [{ name: 'Live', acts: [{ name: 'Volcan', time: null, live: true, note: null }] }]
  let texts: string[] = []
  const stubReader = (read: () => Promise<Lineup>) =>
    lineupReading.setReader({
      async read(text) {
        texts.push(text)
        return read()
      },
    })
  const postText = (key: string | null, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/events/extract-lineup',
      headers: key ? { authorization: `Bearer ${key}` } : {},
      payload: payload as Record<string, unknown>,
    })

  beforeEach(() => {
    texts = []
    stubReader(async () => lineup)
  })
  afterAll(() => lineupReading.reset())

  it('requires authentication', async () => {
    expect((await postText(null, { text: 'Live: Volcan' })).statusCode).toBe(401)
    expect(texts).toEqual([])
  })

  it('returns the lineup read from the text', async () => {
    const res = await postText(keys.publisher, { text: 'Live: Volcan' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { lineup } })
    expect(texts).toEqual(['Live: Volcan'])
  })

  it('rejects an empty or overlong text', async () => {
    expect((await postText(keys.publisher, { text: '   ' })).statusCode).toBe(400)
    expect((await postText(keys.publisher, { text: 'x'.repeat(10_001) })).statusCode).toBe(400)
    expect((await postText(keys.publisher, {})).statusCode).toBe(400)
    expect(texts).toEqual([])
  })

  it.each([
    ['unavailable', 503, 'extraction_unavailable'],
    ['timeout', 504, 'extraction_timeout'],
    ['provider', 502, 'extraction_provider_error'],
    ['invalid_output', 422, 'extraction_failed'],
  ] as const)('maps a %s failure to %i', async (kind, status, code) => {
    stubReader(async () => {
      throw new ExtractionError(kind, 'secret provider detail')
    })
    const res = await postText(keys.publisher, { text: 'Live: Volcan' })
    expect(res.statusCode).toBe(status)
    expect(res.json().error.code).toBe(code)
    expect(res.json().error.message).toMatch(/lineup/i)
    expect(res.body).not.toContain('secret provider detail')
  })

  it('reports a text without a lineup', async () => {
    stubReader(async () => [])
    const res = await postText(keys.publisher, { text: 'A night of dark wave.' })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({ code: 'nothing_extracted', message: 'No lineup found in the description' })
  })

  it('counts against a daily limit per account', async () => {
    const remaining = async () => Number((await postText(keys.scout, { text: 'Live: Volcan' })).headers['x-ratelimit-remaining'])
    const first = await remaining()
    expect(first).toBeLessThan(EXTRACT_DAILY_LIMIT)
    expect(await remaining()).toBe(first - 1)
  })
})
