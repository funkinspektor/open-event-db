import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { eventInterests, events, generateToken, sessions, venues } from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { cleanup, createAccount } from '../test/fixtures.js'

let app: FastifyInstance
const venueIds: string[] = []
beforeAll(async () => {
  app = await buildApp({ logger: false })
})
afterAll(async () => {
  await cleanup()
  for (const id of venueIds) await db.delete(venues).where(eq(venues.id, id))
  await app.close()
})

const DAY = 86_400_000

async function setup() {
  const { account } = await createAccount({ label: 'cal', organizer: false })
  const s = generateToken()
  await db.insert(sessions).values({ accountId: account.id, tokenHash: s.hash, expiresAt: new Date(Date.now() + 3_600_000) })
  const cookie = `oedb_session=${s.token}`
  const rotate = async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/accounts/me/calendar-token', headers: { cookie } })
    expect(r.statusCode).toBe(200)
    return new URL(r.json().data.url as string).pathname
  }
  const mark = async (title: string, daysFromNow: number, extra: Partial<typeof events.$inferInsert> = {}) => {
    const [e] = await db
      .insert(events)
      .values({ title, startsAt: new Date(Date.now() + daysFromNow * DAY), city: 'Berlin', createdBy: account.id, ...extra })
      .returning()
    await db.insert(eventInterests).values({ accountId: account.id, eventId: e!.id })
    return e!
  }
  return { account, rotate, mark }
}

describe('GET /cal/:token.ics', () => {
  it('404s for an unknown token, a missing suffix and a rotated token', async () => {
    const { rotate } = await setup()
    expect((await app.inject({ method: 'GET', url: '/cal/nope.ics' })).statusCode).toBe(404)
    const first = await rotate()
    expect((await app.inject({ method: 'GET', url: first })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: first.slice(0, -4) })).statusCode).toBe(404)
    const second = await rotate()
    expect((await app.inject({ method: 'GET', url: first })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: second })).statusCode).toBe(200)
  })

  it('lists marked events from 90 days back with venue location, without auth', async () => {
    const { rotate, mark, account } = await setup()
    const [venue] = await db.insert(venues).values({ name: 'Cellar', address: 'Gang 1', city: 'Berlin' }).returning()
    venueIds.push(venue!.id)
    const timed = await mark('Timed show', 5, { venueId: venue!.id, description: '**Doors** 22:00' })
    const old = await mark('Old show', -60, { status: 'cancelled', locationText: 'Somewhere' })
    await mark('Too old', -120)
    // not marked
    await db.insert(events).values({ title: 'Unmarked', startsAt: new Date(Date.now() + DAY), city: 'Berlin', createdBy: account.id })
    const path = await rotate()

    const res = await app.inject({ method: 'GET', url: path })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8')
    expect(res.headers['cache-control']).toBe('private, max-age=300')
    const body = res.body
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(body).toContain(`UID:${timed.id}@kellerkompass.de`)
    expect(body).toContain(`UID:${old.id}@kellerkompass.de`)
    expect(body.indexOf(old.id)).toBeLessThan(body.indexOf(timed.id))
    expect(body).toContain('STATUS:CANCELLED')
    expect(body).toContain('LOCATION:Cellar\\, Gang 1\\, Berlin')
    expect(body).toContain('LOCATION:Somewhere\\, Berlin')
    expect(body).toContain('DESCRIPTION:Doors 22:00')
    expect(body).not.toContain('Too old')
    expect(body).not.toContain('Unmarked')
  })

  it('rate-limits to 60 requests per hour per token', async () => {
    const { rotate } = await setup()
    const path = await rotate()
    for (let i = 0; i < 60; i++) expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(429)
  })
})
