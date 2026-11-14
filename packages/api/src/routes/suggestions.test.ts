import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { mySuggestionSchema, suggestionPreviewSchema, type MySuggestion } from '@open-event-db/shared'
import { events, ingestItems, venues } from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { imageStore, memoryImageStore } from '../images/store.js'
import { cleanup, createAccount } from '../test/fixtures.js'
import { cleanupSuggestionImages } from '../cleanup.js'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
const DAY = 86_400_000

type Who = 'plain' | 'other' | 'scout' | 'fresh' | 'lister'

let app: FastifyInstance
let store: ReturnType<typeof memoryImageStore>
let venueId: string
const people = {} as Record<Who, { id: string; auth: Record<string, string> }>

beforeAll(async () => {
  app = await buildApp({ logger: false })
  store = memoryImageStore()
  imageStore.setStore(store)
  const specs: [Who, { scout?: boolean; onboarded?: boolean }][] = [
    ['plain', {}],
    ['other', {}],
    ['scout', { scout: true }],
    ['fresh', { onboarded: false }],
  ]
  for (const [name, opts] of specs) {
    const { account, key } = await createAccount({ label: `sugg-${name}`, organizer: false, ...opts })
    people[name] = { id: account.id, auth: { authorization: `Bearer ${key}` } }
  }
  const [venue] = await db.insert(venues).values({ name: 'Sugg Venue', address: 'Weg 1', city: 'Leipzig' }).returning()
  venueId = venue!.id
})

afterEach(async () => {
  delete process.env.SUGGESTIONS_PER_DAY
  for (const who of ['plain', 'other', 'scout'] as const) {
    await db.delete(ingestItems).where(eq(ingestItems.submittedBy, people[who].id))
  }
  store.objects.clear()
})

afterAll(async () => {
  imageStore.reset()
  await cleanup()
  await db.delete(venues).where(eq(venues.id, venueId))
  await app.close()
})

const soon = () => new Date(Date.now() + 5 * DAY).toISOString()
const body = (over: Record<string, unknown> = {}) => ({ title: 'Keller Nacht', starts_at: soon(), city: 'Berlin', ...over })

const post = (who: Who | null, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/v1/suggestions', headers: who ? people[who].auth : {}, payload: payload as object })
const put = (who: Who, id: string, payload: Buffer = PNG) =>
  app.inject({
    method: 'PUT',
    url: `/api/v1/suggestions/${id}/image`,
    headers: { ...people[who].auth, 'content-type': 'image/png' },
    payload,
  })
const del = (who: Who, path: string) =>
  app.inject({ method: 'DELETE', url: `/api/v1/suggestions/${path}`, headers: people[who].auth })
const list = (who: Who | null) =>
  app.inject({ method: 'GET', url: '/api/v1/accounts/me/suggestions', headers: who ? people[who].auth : {} })
const row = async (id: string) => (await db.select().from(ingestItems).where(eq(ingestItems.id, id)))[0]!
const created = async (who: Who, over: Record<string, unknown> = {}) => (await post(who, body(over))).json().data.id as string

describe('POST /suggestions', () => {
  it('creates a pending item in the suggestions source', async () => {
    const res = await post(
      'plain',
      body({ description: 'Laut', links: { instagram: 'https://www.instagram.com/keller' }, venue_id: venueId, city: undefined }),
    )
    expect(res.statusCode).toBe(201)
    const data = mySuggestionSchema.parse(res.json().data)
    expect(data.status).toBe('in_review')
    const item = await row(data.id)
    expect(item.submittedBy).toBe(people.plain.id)
    expect(item.externalId).toBe(item.id)
    expect(item.status).toBe('pending')
    expect(item.draft).toMatchObject({
      title: 'Keller Nacht',
      venue_id: venueId,
      city: 'Leipzig',
      description: 'Laut',
      links: { instagram: 'https://www.instagram.com/keller' },
      image_url: null,
      // The first link stands in for the "Original" of a feed item
      source_url: 'https://www.instagram.com/keller',
    })
    expect(item.contentHash).toBeNull()
    expect((await row(await created('plain'))).draft).toMatchObject({ source_url: null })
  })

  it('needs a city without a venue, and a known venue', async () => {
    expect((await post('plain', body({ city: undefined }))).statusCode).toBe(400)
    const res = await post('plain', body({ venue_id: '00000000-0000-4000-8000-000000000000' }))
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('venue_not_found')
  })

  it('refuses an event that is over', async () => {
    const res = await post(
      'plain',
      body({ starts_at: new Date(Date.now() - 2 * DAY).toISOString(), ends_at: new Date(Date.now() - DAY).toISOString() }),
    )
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('event_over')
  })

  it('refuses what the inbox would hide: a night that started yesterday, sent after midnight', async () => {
    // 01:00 Berlin on 2 March; the night started at 23:00 on 1 March and has no end
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2031-03-02T00:00:00Z'))
      const res = await post('plain', body({ starts_at: '2031-03-01T22:00:00Z', categories: ['party'] }))
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('event_over')
      // A day-only suggestion for today is still open
      expect((await post('plain', body({ starts_at: '2031-03-02' }))).statusCode).toBe(201)
    } finally {
      vi.useRealTimers()
    }
  })

  it('limit: the sixth suggestion of the day is refused', async () => {
    for (let i = 0; i < 5; i++) expect((await post('plain', body())).statusCode).toBe(201)
    const res = await post('plain', body())
    expect(res.statusCode).toBe(429)
    expect(res.json().error).toEqual({
      code: 'suggestion_limit',
      message: "You've sent 5 suggestions today. Try again tomorrow.",
    })
    // another account is unaffected
    expect((await post('other', body())).statusCode).toBe(201)
  })

  it('limit follows SUGGESTIONS_PER_DAY', async () => {
    process.env.SUGGESTIONS_PER_DAY = '2'
    expect((await post('plain', body())).statusCode).toBe(201)
    expect((await post('plain', body())).statusCode).toBe(201)
    const res = await post('plain', body())
    expect(res.statusCode).toBe(429)
    expect(res.json().error.message).toBe("You've sent 2 suggestions today. Try again tomorrow.")
  })

  it('limit counts withdrawn suggestions', async () => {
    process.env.SUGGESTIONS_PER_DAY = '2'
    const a = await created('plain')
    expect((await del('plain', a)).statusCode).toBe(204)
    expect((await post('plain', body())).statusCode).toBe(201)
    expect((await post('plain', body())).statusCode).toBe(429)
  })

  it('limit holds under parallel sends', async () => {
    for (let i = 0; i < 4; i++) expect((await post('plain', body())).statusCode).toBe(201)
    const results = await Promise.all([post('plain', body()), post('plain', body()), post('plain', body())])
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 429, 429])
  })

  it('requires an onboarded account', async () => {
    expect((await post(null, body())).statusCode).toBe(401)
    const res = await post('fresh', body())
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('onboarding_required')
    expect((await list(null)).statusCode).toBe(401)
    expect((await list('fresh')).statusCode).toBe(403)
  })

  it('POST /events stays closed to plain accounts', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/events', headers: people.plain.auth, payload: body() })
    expect(res.statusCode).toBe(403)
  })
})

describe('suggestion images and withdrawal', () => {
  it('image upload and removal on an own pending suggestion', async () => {
    const id = await created('plain')
    const up = await put('plain', id)
    expect(up.statusCode).toBe(200)
    const item = await row(id)
    expect(item.imageKey).toMatch(new RegExp(`^suggestions/${id}/.+\\.png$`))
    expect((item.draft as { image_url: string }).image_url).toBe(store.url(item.imageKey!))
    expect(up.json().data.image_url).toBe(store.url(item.imageKey!))
    expect(store.objects.has(item.imageKey!)).toBe(true)

    // replacing deletes the old object
    const first = item.imageKey!
    await put('plain', id)
    expect(store.objects.has(first)).toBe(false)
    expect(store.objects.size).toBe(1)

    const gone = await del('plain', `${id}/image`)
    expect(gone.statusCode).toBe(200)
    const after = await row(id)
    expect(after.imageKey).toBeNull()
    expect((after.draft as { image_url: unknown }).image_url).toBeNull()
    expect(store.objects.size).toBe(0)
  })

  it('refuses a body that is not an image', async () => {
    const id = await created('plain')
    expect((await put('plain', id, Buffer.from('not an image at all'))).statusCode).toBe(415)
  })

  it("another account's suggestion is not found", async () => {
    const id = await created('plain')
    expect((await put('other', id)).statusCode).toBe(404)
    expect((await del('other', `${id}/image`)).statusCode).toBe(404)
    expect((await del('other', id)).statusCode).toBe(404)
    expect((await del('plain', 'nope')).statusCode).toBe(404)
    expect((await row(id)).status).toBe('pending')
  })

  it('withdraw: own pending only', async () => {
    const id = await created('plain')
    await put('plain', id)
    expect((await del('plain', id)).statusCode).toBe(204)
    const item = await row(id)
    expect(item.status).toBe('withdrawn')
    expect(item.imageKey).toBeNull()
    expect(store.objects.size).toBe(0)
    expect((await del('plain', id)).statusCode).toBe(404)

    const rejected = await created('plain')
    await db.update(ingestItems).set({ status: 'rejected' }).where(eq(ingestItems.id, rejected))
    expect((await del('plain', rejected)).statusCode).toBe(409)
    expect((await put('plain', rejected)).statusCode).toBe(409)
    expect((await row(rejected)).status).toBe('rejected')
  })

  it('withdraw: a failed image delete keeps the key, so the cleanup deletes it', async () => {
    const id = await created('plain')
    await put('plain', id)
    const key = (await row(id)).imageKey!
    const realDelete = store.delete
    store.delete = async () => {
      throw new Error('store down')
    }
    try {
      expect((await del('plain', id)).statusCode).toBe(204)
    } finally {
      store.delete = realDelete
    }
    const item = await row(id)
    expect(item.status).toBe('withdrawn')
    expect(item.imageKey).toBe(key)
    expect(store.objects.has(key)).toBe(true)

    await cleanupSuggestionImages()
    expect(store.objects.has(key)).toBe(false)
    const after = await row(id)
    expect(after.imageKey).toBeNull()
    expect((after.draft as { image_url: unknown }).image_url).toBeNull()
  })
})

describe('GET /accounts/me/suggestions', () => {
  it('lists statuses, newest first, privately', async () => {
    // its own account: the shared one has used up this minute's write rate limit
    const { account, key } = await createAccount({ label: 'sugg-lister', organizer: false })
    people.lister = { id: account.id, auth: { authorization: `Bearer ${key}` } }
    process.env.SUGGESTIONS_PER_DAY = '10'
    const pending = await created('lister', { title: 'Pending one' })
    const rejected = await created('lister', { title: 'Rejected one' })
    const accepted = await created('lister', { title: 'Accepted one' })
    const linked = await created('lister', { title: 'Linked one' })
    const withdrawn = await created('lister', { title: 'Withdrawn one' })
    await del('lister', withdrawn)
    await created('other', { title: 'Not mine' })

    const mkEvent = async (title: string) =>
      (
        await db
          .insert(events)
          .values({ title, startsAt: new Date(Date.now() + 3 * DAY), city: 'Berlin', createdBy: people.scout.id })
          .returning()
      )[0]!
    const e1 = await mkEvent('Made event')
    const e2 = await mkEvent('Existing event')
    const set = (id: string, v: Partial<typeof ingestItems.$inferInsert>, ageMin: number) =>
      db
        .update(ingestItems)
        .set({ ...v, firstSeenAt: new Date(Date.now() - ageMin * 60_000) })
        .where(eq(ingestItems.id, id))
    await set(pending, {}, 1)
    await set(rejected, { status: 'rejected', rejectReason: 'Not our thing' }, 2)
    await set(accepted, { status: 'accepted', eventId: e1.id }, 3)
    await set(linked, { status: 'accepted', eventId: e2.id, decidedAt: new Date() }, 4)

    const res = await list('lister')
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-store')
    const data = res.json().data as MySuggestion[]
    data.forEach((d) => mySuggestionSchema.parse(d))
    expect(data.map((d) => [d.title, d.status, d.event_id, d.reason])).toEqual([
      ['Pending one', 'in_review', null, null],
      ['Rejected one', 'not_accepted', null, 'Not our thing'],
      ['Accepted one', 'live', e1.id, null],
      ['Linked one', 'live', e2.id, null],
    ])
    expect(data.some((d) => d.id === withdrawn)).toBe(false)
  })

  it('an undecided suggestion whose event is over is expired', async () => {
    const { account, key } = await createAccount({ label: 'sugg-expirer', organizer: false })
    const auth = { authorization: `Bearer ${key}` }
    const send = async (title: string) =>
      (await app.inject({ method: 'POST', url: '/api/v1/suggestions', headers: auth, payload: body({ title }) })).json().data.id as string
    const over = await send('Missed one')
    const open = await send('Open one')
    const rejected = await send('Rejected late')
    const past = { ...(await row(over)).draft, starts_at: new Date(Date.now() - 3 * DAY).toISOString(), ends_at: null }
    await db.update(ingestItems).set({ draft: past }).where(eq(ingestItems.id, over))
    await db.update(ingestItems).set({ draft: past, status: 'rejected' }).where(eq(ingestItems.id, rejected))

    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts/me/suggestions', headers: auth })
    const data = res.json().data as MySuggestion[]
    data.forEach((d) => mySuggestionSchema.parse(d))
    const status = Object.fromEntries(data.map((d) => [d.id, d.status]))
    expect(status).toEqual({ [over]: 'expired', [open]: 'in_review', [rejected]: 'not_accepted' })
    await db.delete(ingestItems).where(eq(ingestItems.submittedBy, account.id))
  })

  it('reads with the normal read limit, not the write limit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts/me/suggestions', headers: people.other.auth, remoteAddress: '203.0.113.77' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-ratelimit-limit']).toBe('100')
  })
})

describe('GET /suggestions/:id', () => {
  const get = (who: Who | null, id: string) =>
    app.inject({ method: 'GET', url: `/api/v1/suggestions/${id}`, headers: who ? people[who].auth : {} })

  it('shows an own pending suggestion as the event it would become', async () => {
    const id = await created('plain', {
      title: 'Preview Night',
      starts_at: '2099-05-01',
      description: 'Laut',
      lineup: [{ name: null, acts: [{ name: 'DJ Keller' }] }],
      venue_id: venueId,
      city: undefined,
      links: { tickets: 'https://example.org/t' },
      categories: ['party'],
    })
    expect((await put('plain', id)).statusCode).toBe(200)

    const res = await get('plain', id)
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-store')
    const { suggestion, preview } = suggestionPreviewSchema.parse(res.json().data)
    expect(suggestion).toMatchObject({ id, status: 'in_review', title: 'Preview Night' })
    expect(preview).toMatchObject({
      id,
      title: 'Preview Night',
      description: 'Laut',
      start_time_known: false,
      status: 'scheduled',
      city: 'Leipzig',
      categories: ['party'],
      links: { tickets: 'https://example.org/t' },
      organizers: [],
      venue: { id: venueId, name: 'Sugg Venue', address: 'Weg 1', city: 'Leipzig', coordinates: null },
      added_by: { id: people.plain.id, is_scout: false },
    })
    expect(preview.lineup).toHaveLength(1)
    expect(preview.image_url).toBe(suggestion.image_url)
    expect(preview.image_url).toMatch(/^https?:\/\//)
    expect('interested' in preview).toBe(false)
  })

  it('keeps start_time_known true for a suggestion with a time, and falls back to the location text', async () => {
    const id = await created('plain', { location_text: 'Hinterhof' })
    const { preview } = (await get('plain', id)).json().data
    expect(preview).toMatchObject({ start_time_known: true, venue: null, location_text: 'Hinterhof', city: 'Berlin', image_url: null })
  })

  it('is not found for another account, a withdrawn suggestion, an unknown id and a non-uuid', async () => {
    const id = await created('plain')
    const other = await get('other', id)
    expect(other.statusCode).toBe(404)
    expect(other.json().error.code).toBe('not_found')
    expect((await get('plain', 'not-a-uuid')).statusCode).toBe(404)
    expect((await get('plain', '00000000-0000-0000-0000-000000000000')).statusCode).toBe(404)
    expect((await del('plain', id)).statusCode).toBe(204)
    expect((await get('plain', id)).statusCode).toBe(404)
  })

  it('needs a session or key, and an onboarded account', async () => {
    // Another account sends it: 'plain' is close to the write limit by now
    const id = await created('other')
    expect((await get(null, id)).statusCode).toBe(401)
    expect((await get('fresh', id)).statusCode).toBe(403)
  })
})
