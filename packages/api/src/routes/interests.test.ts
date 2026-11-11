import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { eventDetailSchema, eventSlimSchema } from '@open-event-db/shared'
import { eventInterests, events, generateToken, sessions } from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { cleanup, createAccount } from '../test/fixtures.js'

let app: FastifyInstance
beforeAll(async () => {
  app = await buildApp({ logger: false })
})
afterAll(async () => {
  await cleanup()
  await app.close()
})

const call = (method: 'GET' | 'PUT' | 'DELETE', url: string, headers: Record<string, string> = {}) =>
  app.inject({ method, url: `/api/v1${url}`, headers })

async function setup() {
  const { account, key } = await createAccount({ label: 'fan', organizer: false })
  const auth = { authorization: `Bearer ${key}` }
  const mk = async (title: string, daysAhead: number) => {
    const [e] = await db
      .insert(events)
      .values({
        title,
        startsAt: new Date(Date.now() + daysAhead * 86_400_000),
        city: 'Berlin',
        createdBy: account.id,
      })
      .returning()
    return e!
  }
  return { account, auth, mk }
}

describe('interests', () => {
  it('put twice leaves one row; delete twice is 204 both; unknown id is 404', async () => {
    const { account, auth, mk } = await setup()
    const e = await mk('Interest A', 3)
    expect((await call('PUT', `/events/${e.id}/interest`, auth)).statusCode).toBe(204)
    expect((await call('PUT', `/events/${e.id}/interest`, auth)).statusCode).toBe(204)
    expect(await db.select().from(eventInterests).where(eq(eventInterests.accountId, account.id))).toHaveLength(1)
    expect((await call('DELETE', `/events/${e.id}/interest`, auth)).statusCode).toBe(204)
    expect((await call('DELETE', `/events/${e.id}/interest`, auth)).statusCode).toBe(204)
    expect(await db.select().from(eventInterests).where(eq(eventInterests.accountId, account.id))).toHaveLength(0)
    const nope = '00000000-0000-4000-8000-000000000000'
    expect((await call('PUT', `/events/${nope}/interest`, auth)).statusCode).toBe(404)
    expect((await call('DELETE', `/events/${nope}/interest`, auth)).statusCode).toBe(404)
    expect((await call('PUT', `/events/${e.id}/interest`)).statusCode).toBe(401)
    // Hard-deleted event: the FK violation (23503) maps to 404, not 500 (the PUT has no pre-check)
    await db.delete(events).where(eq(events.id, e.id))
    expect((await call('PUT', `/events/${e.id}/interest`, auth)).statusCode).toBe(404)
    expect((await call('GET', '/accounts/me/interests')).statusCode).toBe(401)
  })

  it('mine=true needs auth and returns only marked matching events', async () => {
    const { auth, mk } = await setup()
    const a = await mk('Zebrafinch night', 3)
    const b = await mk('Zebrafinch day', 4)
    await mk('Zebrafinch unmarked', 5)
    const other = await mk('Marked other', 6)
    for (const e of [a, b, other]) await call('PUT', `/events/${e.id}/interest`, auth)

    expect((await call('GET', '/events?mine=true')).statusCode).toBe(401)
    const r = await call('GET', '/events?mine=true&q=Zebrafinch', auth)
    expect(r.statusCode).toBe(200)
    expect(r.json().data.map((x: { id: string }) => x.id)).toEqual([a.id, b.id])
    const paged = await call('GET', '/events?mine=true&limit=1', auth)
    expect(paged.json().data).toHaveLength(1)
    expect(paged.json().meta.has_more).toBe(true)
    const page2 = await call('GET', `/events?mine=true&limit=1&cursor=${encodeURIComponent(paged.json().meta.cursor)}`, auth)
    const ids = [...paged.json().data, ...page2.json().data].map((x: { id: string }) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(2)
    expect((await call('GET', '/events?mine=maybe', auth)).statusCode).toBe(400)
    const off = await call('GET', '/events?mine=false&q=Zebrafinch', auth)
    expect(off.json().data).toHaveLength(3)
  })

  it('list is identical for anonymous and authenticated callers without mine', async () => {
    const { auth, mk } = await setup()
    const e = await mk('Identical list qqxz', 3)
    await call('PUT', `/events/${e.id}/interest`, auth)
    const anon = await call('GET', '/events?q=qqxz')
    const authed = await call('GET', '/events?q=qqxz', auth)
    expect(authed.body).toBe(anon.body)
  })

  it('detail has interested only when authenticated; no counts anywhere', async () => {
    const { auth, mk } = await setup()
    const e = await mk('Detail interest', 3)
    const anon = await call('GET', `/events/${e.id}`)
    expect('interested' in anon.json().data).toBe(false)
    expect((await call('GET', `/events/${e.id}`, auth)).json().data.interested).toBe(false)
    await call('PUT', `/events/${e.id}/interest`, auth)
    const authed = await call('GET', `/events/${e.id}`, auth)
    expect(authed.json().data.interested).toBe(true)

    expect(anon.headers.vary).toMatch(/Cookie/)
    expect(anon.headers.vary).toMatch(/Authorization/)
    expect(anon.headers['cache-control'] ?? '').not.toMatch(/private/)
    expect(authed.headers.vary).toMatch(/Cookie/)
    expect(authed.headers.vary).toMatch(/Authorization/)
    expect(authed.headers['cache-control']).toMatch(/private/)

    for (const body of [anon.body, authed.body]) expect(body).not.toMatch(/interest_count|interests?_?count/)
    const detailKeys = Object.keys(eventDetailSchema.shape)
    expect(Object.keys(authed.json().data).every((k) => detailKeys.includes(k))).toBe(true)
    const list = await call('GET', '/events?q=Detail%20interest', auth)
    const slimKeys = Object.keys(eventSlimSchema.shape)
    expect(Object.keys(list.json().data[0]).sort()).toEqual(slimKeys.sort())
  })

  it('invalid session cookie on public reads is treated as anonymous', async () => {
    const { mk } = await setup()
    const e = await mk('Bad cookie', 3)
    const h = { cookie: 'oedb_session=garbage' }
    const d = await call('GET', `/events/${e.id}`, h)
    expect(d.statusCode).toBe(200)
    expect('interested' in d.json().data).toBe(false)
    expect((await call('GET', '/events', h)).statusCode).toBe(200)
    expect((await call('GET', '/events?mine=true', h)).statusCode).toBe(401)
  })

  it('works with a browser session cookie', async () => {
    const { account, mk } = await setup()
    const e = await mk('Cookie interest', 3)
    const s = generateToken()
    await db.insert(sessions).values({ accountId: account.id, tokenHash: s.hash, expiresAt: new Date(Date.now() + 3_600_000) })
    const h = { cookie: `oedb_session=${s.token}` }
    expect((await call('PUT', `/events/${e.id}/interest`, h)).statusCode).toBe(204)
    expect((await call('GET', `/events/${e.id}`, h)).json().data.interested).toBe(true)
  })

  it('GET /accounts/me/interests filters by start time; hard-deleted events leave no rows', async () => {
    const { auth, mk } = await setup()
    const soon = await mk('Soon', 2)
    const later = await mk('Later', 20)
    for (const e of [soon, later]) await call('PUT', `/events/${e.id}/interest`, auth)
    const all = await call('GET', '/accounts/me/interests', auth)
    expect(all.json().data.event_ids.sort()).toEqual([soon.id, later.id].sort())
    const mid = encodeURIComponent(new Date(Date.now() + 10 * 86_400_000).toISOString())
    expect((await call('GET', `/accounts/me/interests?to=${mid}`, auth)).json().data.event_ids).toEqual([soon.id])
    expect((await call('GET', `/accounts/me/interests?from=${mid}`, auth)).json().data.event_ids).toEqual([later.id])
    expect((await call('GET', '/accounts/me/interests?from=nonsense', auth)).statusCode).toBe(400)

    await db.delete(events).where(eq(events.id, soon.id))
    expect(await db.select().from(eventInterests).where(eq(eventInterests.eventId, soon.id))).toHaveLength(0)
    const after = await call('GET', '/accounts/me/interests', auth)
    expect(after.statusCode).toBe(200)
    expect(after.json().data.event_ids).toEqual([later.id])
  })
})
