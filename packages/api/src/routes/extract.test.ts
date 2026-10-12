import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { inArray } from 'drizzle-orm'
import { generateApiKey, publishers, type Publisher } from '@open-event-db/db'
import { EXTRACT_DAILY_LIMIT, type Extraction } from '@open-event-db/shared'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { ExtractionError, vision, type ExtractImage } from '../extract/vision.js'

let app: FastifyInstance
const created: Publisher[] = []
const keys: Record<'publisher' | 'scout' | 'limited', string> = { publisher: '', scout: '', limited: '' }
const stamp = Date.now()

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32)])

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
  tags: ['Techno'],
  links: [{ kind: 'instagram', url: '@keller' }],
}

let received: ExtractImage[] = []
const stub = (result: () => Promise<Extraction>) =>
  vision.setExtractor({
    async extract(image) {
      received.push(image)
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
        tags: ['techno'],
        links: { instagram: 'https://www.instagram.com/keller' },
      })
    }
  })

  it('passes the sniffed image type, not the claimed one', async () => {
    await post(keys.publisher, WEBP, 'image/png')
    expect(received[0]?.type).toBe('image/webp')
  })

  it('rejects bodies that are not images', async () => {
    expect((await post(keys.publisher, Buffer.from('not an image at all'))).statusCode).toBe(415)
    const json = await post(keys.publisher, JSON.stringify({ hello: 'world' }), 'application/json')
    expect(json.statusCode).toBe(415)
    expect(json.json().error.code).toBe('unsupported_media_type')
    expect(received).toHaveLength(0)
  })

  it('rejects images over 10 MB', async () => {
    const res = await post(keys.publisher, Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]))
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('payload_too_large')
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
