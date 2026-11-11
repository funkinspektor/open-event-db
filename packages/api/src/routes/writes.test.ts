import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { desc, eq, inArray } from 'drizzle-orm'
import { editHistory, eventOrganizers, events, ingestSources, venues, type Account, type Organizer, type Venue } from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { cleanup, createAccount, createOrganizer } from '../test/fixtures.js'

let app: FastifyInstance
let alice: Account
let bob: Account
let scout: Account
let scout2: Account
let orgA: Organizer
let orgB: Organizer
let keyA: string
let keyB: string
let keyS: string
let keyS2: string
let venue: Venue
const stamp = Date.now()

const auth = (key: string) => ({ authorization: `Bearer ${key}` })

beforeAll(async () => {
  app = await buildApp({ logger: false })

  const a = await createAccount({ label: 'alice' })
  const b = await createAccount({ label: 'bob' })
  const s1 = await createAccount({ scout: true, organizer: false, label: 'scout' })
  const s2 = await createAccount({ scout: true, organizer: false, label: 'scout2' })
  alice = a.account
  bob = b.account
  scout = s1.account
  scout2 = s2.account
  orgA = a.organizer!
  orgB = b.organizer!
  keyA = a.key
  keyB = b.key
  keyS = s1.key
  keyS2 = s2.key

  const [v] = await db
    .insert(venues)
    .values({ name: `Test Venue ${stamp}`, address: '1 Test St', city: 'Testcity', coordinates: [13.4, 52.5] })
    .returning()
  venue = v!
})

afterAll(async () => {
  await cleanup()
  await db.delete(venues).where(eq(venues.id, venue.id))
  await db.delete(venues).where(eq(venues.name, `Created Venue ${stamp}`))
  await app.close()
})

// The CLI subprocess inherits this process's environment, so it talks to the same DATABASE_URL as the tests
const cliPath = fileURLToPath(new URL('../../../db/src/cli.ts', import.meta.url))
const dbDir = fileURLToPath(new URL('../../../db', import.meta.url))
const cli = (...args: (string | { stdio: 'pipe' })[]) => {
  const opts = args.find((a): a is { stdio: 'pipe' } => typeof a === 'object')
  return execFileSync(
    process.execPath,
    ['--import', 'tsx', cliPath, ...args.filter((a): a is string => typeof a === 'string')],
    { cwd: dbDir, encoding: 'utf8', env: process.env, ...opts },
  )
}

describe('auth middleware', () => {
  it('rejects unauthenticated writes with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/events', payload: {} })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthorized')
  })

  it('rejects an unknown API key with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth('oevt_definitely-not-a-real-key-000000'),
      payload: {},
    })
    expect(res.statusCode).toBe(401)
  })

  it('leaves reads open', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/events' })
    expect(res.statusCode).toBe(200)
  })
})

describe('events write flow', () => {
  let eventId: string

  it('validates the body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: { title: '' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
  })

  it('requires city when there is no venue', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: { title: 'No city', starts_at: '2030-01-01T20:00:00Z' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('creates an event, fills city from venue, sets creator, normalizes tags', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: {
        title: 'Test Night',
        starts_at: '2030-01-01T20:00:00Z',
        ends_at: '2030-01-02T04:00:00Z',
        venue_id: venue.id,
        tags: [' Techno', 'techno', 'Open-Air '],
        links: { ra: 'https://ra.co/events/1' },
      },
    })
    expect(res.statusCode).toBe(201)
    const e = res.json().data
    eventId = e.id
    expect(e.city).toBe('Testcity')
    expect(e.status).toBe('scheduled')
    expect(e.tags).toEqual(['techno', 'open-air'])
    expect(e.venue.id).toBe(venue.id)
    expect(e.organizers).toEqual([
      expect.objectContaining({ id: orgA.id, role: 'creator' }),
    ])
    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, eventId))
    expect(history.map((h) => h.action)).toEqual(['created'])
  })

  it('forbids edits by non-owners', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyB),
      payload: { title: 'Hijacked' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('only the creator can add co-hosts', async () => {
    const byBob = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/organizers`,
      headers: auth(keyB),
      payload: { organizer_id: orgB.id },
    })
    expect(byBob.statusCode).toBe(403)

    const byAlice = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/organizers`,
      headers: auth(keyA),
      payload: { organizer_id: orgB.id },
    })
    expect(byAlice.statusCode).toBe(201)
    expect(byAlice.json().data.organizers).toHaveLength(2)

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/organizers`,
      headers: auth(keyA),
      payload: { organizer_id: orgB.id },
    })
    expect(again.statusCode).toBe(400)
  })

  it('co-hosts can edit and postpone but not cancel', async () => {
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyB),
      payload: { title: 'Test Night (co-edited)', status: 'postponed' },
    })
    expect(edit.statusCode).toBe(200)
    expect(edit.json().data.title).toBe('Test Night (co-edited)')
    expect(edit.json().data.status).toBe('postponed')

    const cancel = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyB),
      payload: { status: 'cancelled' },
    })
    expect(cancel.statusCode).toBe(403)

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyB),
    })
    expect(del.statusCode).toBe(403)
  })

  it('the creator cannot be removed, co-hosts can', async () => {
    const removeCreator = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${eventId}/organizers/${orgA.id}`,
      headers: auth(keyA),
    })
    expect(removeCreator.statusCode).toBe(400)

    const removeBob = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${eventId}/organizers/${orgB.id}`,
      headers: auth(keyA),
    })
    expect(removeBob.statusCode).toBe(200)
    expect(removeBob.json().data.organizers).toHaveLength(1)
  })

  it('the creator can cancel via DELETE and it is logged as cancelled', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyA),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe('cancelled')

    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, eventId))
    expect(history.map((h) => h.action)).toContain('cancelled')
  })

  it('cancelled events are hidden from the default list but visible with status filter', async () => {
    const def = await app.inject({ method: 'GET', url: `/api/v1/events?organizer_id=${orgA.id}` })
    expect(def.json().data.map((e: { id: string }) => e.id)).not.toContain(eventId)

    const all = await app.inject({
      method: 'GET',
      url: `/api/v1/events?organizer_id=${orgA.id}&status=scheduled,postponed,cancelled`,
    })
    expect(all.json().data.map((e: { id: string }) => e.id)).toContain(eventId)
  })
})

describe('venues write flow', () => {
  it('any member of a verified organizer can create and edit venues', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/venues',
      headers: auth(keyA),
      payload: {
        name: `Created Venue ${stamp}`,
        address: '2 Test St',
        city: 'Testcity',
        coordinates: { lat: 52.51, lng: 13.41 },
      },
    })
    expect(created.statusCode).toBe(201)
    const v = created.json().data
    expect(v.coordinates).toEqual({ lat: 52.51, lng: 13.41 })

    const edited = await app.inject({
      method: 'PUT',
      url: `/api/v1/venues/${v.id}`,
      headers: auth(keyB),
      payload: { address: '3 Test St' },
    })
    expect(edited.statusCode).toBe(200)
    expect(edited.json().data.address).toBe('3 Test St')
  })

  it('lists the feeds that carry a venue and filters venues by having one', async () => {
    const made = await db
      .insert(venues)
      .values(
        ['Linked', 'Mapped', 'Disabled', 'Bare'].map((n) => ({ name: `Feed ${n} ${stamp}`, address: '1 Test St', city: 'Testcity' })),
      )
      .returning()
    const [linked, mapped, disabled, bare] = made as [Venue, Venue, Venue, Venue]
    const source = { kind: 'ical' as const, url: 'https://feed.test/feed.ics', accountId: scout.id }
    await db.insert(ingestSources).values([
      { ...source, slug: `feed-linked-${stamp}`, name: 'Linked feed', venueId: linked.id },
      { ...source, slug: `feed-mapped-${stamp}`, name: 'Mapped feed', config: { venues: { 'Room 1': mapped.id } } },
      { ...source, slug: `feed-off-${stamp}`, name: 'Disabled feed', venueId: disabled.id, enabled: false },
    ])
    try {
      const list = async (feed?: string) => {
        const qs = new URLSearchParams({ q: `${stamp}`, ...(feed ? { feed } : {}) })
        const res = await app.inject({ method: 'GET', url: `/api/v1/venues?${qs}` })
        expect(res.statusCode).toBe(200)
        return res.json().data as { id: string; feeds: { slug: string; name: string }[] }[]
      }
      const all = await list()
      expect(all.find((v) => v.id === linked.id)?.feeds).toEqual([{ slug: `feed-linked-${stamp}`, name: 'Linked feed' }])
      expect(all.find((v) => v.id === mapped.id)?.feeds).toEqual([{ slug: `feed-mapped-${stamp}`, name: 'Mapped feed' }])
      expect(all.find((v) => v.id === disabled.id)?.feeds).toEqual([])

      const none = (await list('none')).map((v) => v.id)
      expect(none).toEqual(expect.arrayContaining([disabled.id, bare.id]))
      expect(none).not.toContain(linked.id)
      expect(none).not.toContain(mapped.id)
      expect((await list('any')).map((v) => v.id).sort()).toEqual([linked.id, mapped.id].sort())

      const detail = await app.inject({ method: 'GET', url: `/api/v1/venues/${linked.id}` })
      expect(detail.json().data.feeds).toEqual([{ slug: `feed-linked-${stamp}`, name: 'Linked feed' }])
    } finally {
      await db.delete(ingestSources).where(eq(ingestSources.accountId, scout.id))
      await db.delete(venues).where(inArray(venues.id, made.map((v) => v.id)))
    }
  })
})

describe('event list order', () => {
  it('order=desc returns newest first and paginates with the cursor', async () => {
    const starts = ['2020-01-01T20:00:00Z', '2020-02-01T20:00:00Z', '2020-03-01T20:00:00Z']
    for (const [i, starts_at] of starts.entries()) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: auth(keyA),
        payload: { title: `Order test ${i}`, starts_at, venue_id: venue.id },
      })
      expect(res.statusCode).toBe(201)
    }

    const page = async (cursor?: string) => {
      const qs = new URLSearchParams({ venue_id: venue.id, to: '2021-01-01T00:00:00Z', order: 'desc', limit: '2' })
      if (cursor) qs.set('cursor', cursor)
      const res = await app.inject({ method: 'GET', url: `/api/v1/events?${qs}` })
      expect(res.statusCode).toBe(200)
      return res.json() as { data: { starts_at: string }[]; meta: { cursor: string | null; has_more: boolean } }
    }

    const first = await page()
    expect(first.data.map((e) => e.starts_at)).toEqual(['2020-03-01T20:00:00.000Z', '2020-02-01T20:00:00.000Z'])
    expect(first.meta.has_more).toBe(true)

    const second = await page(first.meta.cursor!)
    expect(second.data.map((e) => e.starts_at)).toEqual(['2020-01-01T20:00:00.000Z'])
    expect(second.meta.has_more).toBe(false)
  })

  it('rejects an unknown order', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/events?order=sideways' })
    expect(res.statusCode).toBe(400)
  })
})

describe('events stay listed until they are over', () => {
  const create = async (title: string, starts_at: string, ends_at?: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: { title: `${title} ${stamp}`, starts_at, ends_at, venue_id: venue.id },
    })
    expect(res.statusCode).toBe(201)
    return res.json().data.id as string
  }
  const ids = async (params: Record<string, string>) => {
    const qs = new URLSearchParams({ venue_id: venue.id, limit: '100', ...params })
    const res = await app.inject({ method: 'GET', url: `/api/v1/events?${qs}` })
    expect(res.statusCode).toBe(200)
    return (res.json().data as { id: string }[]).map((e) => e.id)
  }

  it('lists from a time on what has not ended by then, assuming an end where there is none', async () => {
    // Berlin (CET): from 02:00 on 6 Nov 2032
    const from = '2032-11-06T01:00:00Z'
    const exhibition = await create('Exhibition', '2032-11-01T10:00:00Z', '2032-11-30T17:00:00Z')
    const party = await create('Party 23:00', '2032-11-05T22:00:00Z') // assumed until 05:00
    const concert = await create('Concert 20:00', '2032-11-05T19:00:00Z') // assumed until 02:00
    const afternoon = await create('Talk 16:00', '2032-11-05T15:00:00Z') // assumed until 00:00
    const ended = await create('Ended', '2032-11-05T21:00:00Z', '2032-11-06T00:30:00Z')
    const later = await create('Later', '2032-11-07T19:00:00Z')

    const listed = await ids({ from, to: '2032-12-01T00:00:00Z' })
    expect(listed).toEqual([exhibition, party, later])
    expect(listed).not.toContain(concert) // ends exactly at `from`
    expect(listed).not.toContain(afternoon)
    expect(listed).not.toContain(ended)
  })

  it('lists running events by default', async () => {
    const hour = 60 * 60 * 1000
    const at = (ms: number) => new Date(Date.now() + ms).toISOString()
    const running = await create('Running', at(-hour))
    const over = await create('Over', at(-3 * hour), at(-hour))
    const listed = await ids({})
    expect(listed).toContain(running)
    expect(listed).not.toContain(over)
  })
})

describe('event categories', () => {
  it('stores categories in a fixed order, filters by any of them and can clear them', async () => {
    const create = async (title: string, categories: string[]) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: auth(keyA),
        payload: { title, starts_at: '2031-05-01T20:00:00Z', venue_id: venue.id, categories },
      })
      expect(res.statusCode).toBe(201)
      return res.json().data as { id: string; categories: string[] }
    }
    const party = await create('Category party', ['party'])
    const concert = await create('Category concert', ['concert'])
    const both = await create('Category both', ['party', 'concert', 'party'])
    const none = await create('Category none', [])
    expect(both.categories).toEqual(['concert', 'party'])
    expect(none.categories).toEqual([])

    const titles = async (categories: string) => {
      const qs = new URLSearchParams({ venue_id: venue.id, from: '2031-05-01T00:00:00Z', to: '2031-05-02T00:00:00Z', categories })
      const res = await app.inject({ method: 'GET', url: `/api/v1/events?${qs}` })
      expect(res.statusCode).toBe(200)
      return (res.json().data as { id: string }[]).map((e) => e.id).sort()
    }
    expect(await titles('concert')).toEqual([concert.id, both.id].sort())
    expect(await titles('party,concert')).toEqual([party.id, concert.id, both.id].sort())

    const cleared = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${both.id}`,
      headers: auth(keyA),
      payload: { categories: [] },
    })
    expect(cleared.json().data.categories).toEqual([])
    expect(await titles('concert')).toEqual([concert.id])
  })

  it('rejects an unknown category in the body and in the list filter', async () => {
    const body = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: { title: 'Bad category', starts_at: '2031-05-01T20:00:00Z', venue_id: venue.id, categories: ['opera'] },
    })
    expect(body.statusCode).toBe(400)
    const list = await app.inject({ method: 'GET', url: '/api/v1/events?categories=opera' })
    expect(list.statusCode).toBe(400)
  })
})

describe('event lineup', () => {
  const lineup = [
    { name: 'Panorama Bar', acts: [{ name: 'Daphni', time: '02:30', note: 'Jiaolong' }, { name: 'Z@P', time: '04:30', live: true }] },
    { name: 'Säule', acts: [{ name: 'Timnah', time: '23:59' }] },
  ]
  const create = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: { title: 'Lineup night', starts_at: '2031-06-01T20:00:00Z', venue_id: venue.id, ...payload },
    })

  it('stores the lineup in listed order and returns it on the event', async () => {
    const res = await create({ lineup })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.lineup).toEqual([
      {
        name: 'Panorama Bar',
        acts: [
          { name: 'Daphni', time: '02:30', live: false, note: 'Jiaolong' },
          { name: 'Z@P', time: '04:30', live: true, note: null },
        ],
      },
      { name: 'Säule', acts: [{ name: 'Timnah', time: '23:59', live: false, note: null }] },
    ])
  })

  it('returns an empty lineup for an event created without one', async () => {
    const res = await create({})
    expect(res.json().data.lineup).toEqual([])
  })

  it('clears the lineup on PUT and logs it in the history', async () => {
    const id = (await create({ lineup })).json().data.id as string
    const res = await app.inject({ method: 'PUT', url: `/api/v1/events/${id}`, headers: auth(keyA), payload: { lineup: [] } })
    expect(res.json().data.lineup).toEqual([])
    const [last] = await db
      .select()
      .from(editHistory)
      .where(eq(editHistory.entityId, id))
      .orderBy(desc(editHistory.createdAt))
      .limit(1)
    expect((last!.diff as Record<string, { after: unknown }>).lineup?.after).toEqual([])
  })

  it('rejects more than 200 acts', async () => {
    const acts = Array.from({ length: 201 }, (_, i) => ({ name: `Act ${i}` }))
    const res = await create({ lineup: [{ acts }] })
    expect(res.statusCode).toBe(400)
  })
})

describe('events without a start time', () => {
  it('stores a bare day as 00:00 Berlin with start_time_known false, and a timestamp turns it back on', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: { title: 'Day only', starts_at: '2031-07-04', venue_id: venue.id },
    })
    expect(created.statusCode).toBe(201)
    const event = created.json().data as { id: string; starts_at: string; start_time_known: boolean }
    expect(event).toMatchObject({ starts_at: '2031-07-03T22:00:00.000Z', start_time_known: false })

    const qs = new URLSearchParams({ venue_id: venue.id, from: '2031-07-03T00:00:00Z', to: '2031-07-05T00:00:00Z' })
    const list = await app.inject({ method: 'GET', url: `/api/v1/events?${qs}` })
    expect(list.json().data).toEqual([expect.objectContaining({ id: event.id, start_time_known: false })])

    const timed = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${event.id}`,
      headers: auth(keyA),
      payload: { starts_at: '2031-07-04T21:00:00+02:00' },
    })
    expect(timed.json().data).toMatchObject({ starts_at: '2031-07-04T19:00:00.000Z', start_time_known: true })

    // Winter time: the day starts at 23:00 UTC the evening before
    const untimed = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${event.id}`,
      headers: auth(keyA),
      payload: { starts_at: '2031-12-24' },
    })
    expect(untimed.json().data).toMatchObject({ starts_at: '2031-12-23T23:00:00.000Z', start_time_known: false })

    const [history] = await db
      .select({ diff: editHistory.diff })
      .from(editHistory)
      .where(eq(editHistory.entityId, event.id))
      .orderBy(desc(editHistory.createdAt))
      .limit(1)
    expect(history?.diff).toMatchObject({ start_time_known: { before: true, after: false } })
  })

  it('rejects anything that is neither a timestamp nor a day', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: { title: 'Bad start', starts_at: '4.7.2031', venue_id: venue.id },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('scouts and unclaimed events', () => {
  let eventId: string

  it('a scout creates an unclaimed event: added_by is the scout, no organizers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyS),
      payload: { title: 'Scouted Night', starts_at: '2030-02-01T22:00:00Z', venue_id: venue.id },
    })
    expect(res.statusCode).toBe(201)
    const e = res.json().data
    eventId = e.id
    expect(e.organizers).toEqual([])
    expect(e.claimed).toBe(false)
    expect(e.added_by).toEqual({ id: scout.id, handle: scout.handle, display_name: scout.displayName, is_scout: true })
    expect(e).not.toHaveProperty('created_by')
  })

  it('organizer-created events stay owned and claimed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: { title: 'Owned Night', starts_at: '2030-02-02T22:00:00Z', venue_id: venue.id },
    })
    const e = res.json().data
    expect(e.claimed).toBe(true)
    expect(e.added_by).toEqual(expect.objectContaining({ id: alice.id, is_scout: false }))
  })

  it('lists unclaimed events in the feed with claimed=false and filters by added_by', async () => {
    const feed = await app.inject({ method: 'GET', url: `/api/v1/events?venue_id=${venue.id}` })
    const row = feed.json().data.find((e: { id: string }) => e.id === eventId)
    expect(row).toEqual(expect.objectContaining({ claimed: false }))

    const added = await app.inject({ method: 'GET', url: `/api/v1/events?added_by=${scout.id}` })
    expect(added.json().data.map((e: { id: string }) => e.id)).toEqual([eventId])
  })

  it('any scout can edit an unclaimed event; a non-member gets 403', async () => {
    const byOtherScout = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyS2),
      payload: { title: 'Scouted Night (fixed)' },
    })
    expect(byOtherScout.statusCode).toBe(200)

    const byMember = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyB),
      payload: { title: 'Hijacked' },
    })
    expect(byMember.statusCode).toBe(403)
  })

  it('nobody can add co-hosts to an unclaimed event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/organizers`,
      headers: auth(keyS),
      payload: { organizer_id: orgB.id },
    })
    expect(res.statusCode).toBe(403)
  })

  it('an unverified or unknown organizer cannot be added as co-host', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: { title: 'Co-host test', starts_at: '2030-02-03T22:00:00Z', venue_id: venue.id },
    })
    const id = created.json().data.id
    const unverified = await createOrganizer([], { verified: false })
    const add = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${id}/organizers`,
      headers: auth(keyA),
      payload: { organizer_id: unverified.id },
    })
    expect(add.statusCode).toBe(400)
    expect(add.json().error.message).toBe('Organizer is not verified')

    const unknown = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${id}/organizers`,
      headers: auth(keyA),
      payload: { organizer_id: '00000000-0000-4000-8000-000000000000' },
    })
    expect(unknown.statusCode).toBe(400)
  })

  it('claim-event makes the organizer creator and locks scouts out', async () => {
    cli('claim-event', eventId, orgA.slug)

    const detail = await app.inject({ method: 'GET', url: `/api/v1/events/${eventId}` })
    const e = detail.json().data
    expect(e.claimed).toBe(true)
    expect(e.provenance).toBe('organizer')
    expect(e.organizers).toEqual([expect.objectContaining({ id: orgA.id, role: 'creator' })])
    expect(e.added_by.id).toBe(scout.id)

    const byScout = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyS),
      payload: { title: 'Too late' },
    })
    expect(byScout.statusCode).toBe(403)

    // The CLI logs the organizer's owner as actor
    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, eventId))
    const claim = history.find((h) => h.action === 'ownership_changed')
    expect(claim?.accountId).toBe(alice.id)
    expect(claim?.diff).toEqual(expect.objectContaining({ via: 'cli' }))

    expect(() => cli('claim-event', eventId, orgB.slug, { stdio: 'pipe' })).toThrow()
  })

  it('scouts can cancel unclaimed events via DELETE', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyS),
      payload: { title: 'Scouted Cancel', starts_at: '2030-02-04T22:00:00Z', venue_id: venue.id },
    })
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${created.json().data.id}`,
      headers: auth(keyS2),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe('cancelled')
  })

  it('delete-event hard-deletes and leaves only a content-free "deleted" history row', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyS),
      payload: { title: 'Scouted Delete', starts_at: '2030-02-05T22:00:00Z', venue_id: venue.id },
    })
    const id = created.json().data.id
    cli('delete-event', id)

    const gone = await app.inject({ method: 'GET', url: `/api/v1/events/${id}` })
    expect(gone.statusCode).toBe(404)
    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, id))
    expect(history).toEqual([expect.objectContaining({ action: 'deleted', accountId: scout.id, diff: { via: 'cli' } })])
  })

  it('delete-event asks before deleting a claimed event', async () => {
    // eventId was claimed by Alice's organizer above; answering anything but "y" aborts
    expect(() =>
      execFileSync(process.execPath, ['--import', 'tsx', cliPath, 'delete-event', eventId], {
        cwd: dbDir,
        input: 'n\n',
        stdio: 'pipe',
      }),
    ).toThrow()
    const orgs = await db.select().from(eventOrganizers).where(eq(eventOrganizers.eventId, eventId))
    expect(orgs).toHaveLength(1)

    cli('delete-event', eventId, '--yes')
    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, eventId))
    expect(history).toEqual([expect.objectContaining({ action: 'deleted', accountId: alice.id })])
  })
})

describe('creating events: whose event is it', () => {
  const eventBody = { title: 'Creation rules', starts_at: '2030-03-01T20:00:00Z', city: 'Testcity' }
  const post = (payload: Record<string, unknown>, key: string) =>
    app.inject({ method: 'POST', url: '/api/v1/events', headers: auth(key), payload })

  it('a scout who is also a member creates an unclaimed event when no organizer_id is given', async () => {
    const { key } = await createAccount({ scout: true }) // owns a verified organizer too
    const res = await post(eventBody, key)
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toMatchObject({ claimed: false, organizers: [], provenance: 'scout' })
  })

  it('with organizer_id the event belongs to that organizer', async () => {
    const { key, organizer } = await createAccount({ scout: true })
    const res = await post({ ...eventBody, organizer_id: organizer!.id }, key)
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toMatchObject({
      claimed: true,
      provenance: 'organizer',
      organizers: [{ id: organizer!.id, name: organizer!.name, slug: organizer!.slug, role: 'creator' }],
    })
  })

  it('a member of one organizer creates for it without organizer_id', async () => {
    const res = await post(eventBody, keyA)
    expect(res.statusCode).toBe(201)
    expect(res.json().data.organizers).toEqual([expect.objectContaining({ id: orgA.id, role: 'creator' })])
    expect(res.json().data.added_by).toEqual({ id: alice.id, handle: alice.handle, display_name: alice.displayName, is_scout: false })
  })

  it('a member of two organizers must choose: 400 organizer_required', async () => {
    const { account, key, organizer } = await createAccount()
    const second = await createOrganizer([account.id])
    const res = await post(eventBody, key)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('organizer_required')

    const chosen = await post({ ...eventBody, organizer_id: second.id }, key)
    expect(chosen.statusCode).toBe(201)
    expect(chosen.json().data.organizers).toEqual([expect.objectContaining({ id: second.id, role: 'creator' })])
    expect(organizer).not.toBeNull()
  })

  it("someone else's organizer_id is 403 not_a_member", async () => {
    const res = await post({ ...eventBody, organizer_id: orgB.id }, keyA)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('not_a_member')
    const scoutRes = await post({ ...eventBody, organizer_id: orgB.id }, keyS)
    expect(scoutRes.statusCode).toBe(403)
    expect(scoutRes.json().error.code).toBe('not_a_member')
  })

  it('a member of an unverified organizer cannot create or edit', async () => {
    const { account, key, organizer } = await createAccount({ organizer: { verified: false } })
    const noRights = await post(eventBody, key)
    expect(noRights.statusCode).toBe(403)
    const explicit = await post({ ...eventBody, organizer_id: organizer!.id }, key)
    expect(explicit.statusCode).toBe(403)
    expect(explicit.json().error.code).toBe('no_rights')

    const [e] = await db
      .insert(events)
      .values({ title: 'Unverified event', startsAt: new Date('2030-03-02T20:00:00Z'), city: 'Testcity', createdBy: account.id })
      .returning()
    await db.insert(eventOrganizers).values({ eventId: e!.id, organizerId: organizer!.id, role: 'creator' })
    const edit = await app.inject({ method: 'PUT', url: `/api/v1/events/${e!.id}`, headers: auth(key), payload: { title: 'Nope' } })
    expect(edit.statusCode).toBe(403)
  })

  it('an account without rights cannot create', async () => {
    const { key } = await createAccount({ organizer: false })
    const res = await post(eventBody, key)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('no_rights')
  })

  it('co-host management uses organizer ids and logs ownership_changed', async () => {
    const created = await post(eventBody, keyA)
    const id = created.json().data.id as string
    const add = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${id}/organizers`,
      headers: auth(keyA),
      payload: { organizer_id: orgB.id },
    })
    expect(add.statusCode).toBe(201)
    expect(add.json().data.organizers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: orgA.id, role: 'creator' }),
        expect.objectContaining({ id: orgB.id, role: 'co_host' }),
      ]),
    )
    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, id))
    const change = history.find((h) => h.action === 'ownership_changed')
    expect(change?.accountId).toBe(alice.id)
    expect(change?.diff).toEqual({ organizers: { before: [orgA.id], after: [orgA.id, orgB.id] } })

    const remove = await app.inject({ method: 'DELETE', url: `/api/v1/events/${id}/organizers/${orgB.id}`, headers: auth(keyA) })
    expect(remove.statusCode).toBe(200)
    expect(remove.json().data.organizers).toHaveLength(1)
  })

  it("GET /events?organizer_id= lists the organizer's events", async () => {
    const { key, organizer } = await createAccount()
    const mineRes = await post(eventBody, key)
    await post(eventBody, keyB)
    const list = await app.inject({ method: 'GET', url: `/api/v1/events?organizer_id=${organizer!.id}&from=2030-01-01T00:00:00Z` })
    expect(list.statusCode).toBe(200)
    expect(list.json().data.map((e: { id: string }) => e.id)).toEqual([mineRes.json().data.id])
  })
})
