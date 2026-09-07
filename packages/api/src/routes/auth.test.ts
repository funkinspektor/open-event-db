import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { editHistory, events, magicLinkTokens, publishers, sessions } from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { email } from '../email.js'

let app: FastifyInstance
let publisherId: string
const stamp = Date.now()
const address = `login-${stamp}@test.local`
const outbox: { to: string; url: string }[] = []

beforeAll(async () => {
  email.setTransport({
    async sendMagicLink(msg) {
      outbox.push(msg)
    },
  })
  app = await buildApp({ logger: false })
  const [p] = await db
    .insert(publishers)
    .values({ name: 'Login Tester', slug: `login-tester-${stamp}`, email: address, verified: true })
    .returning()
  publisherId = p!.id
})

afterAll(async () => {
  await db.delete(editHistory).where(eq(editHistory.publisherId, publisherId))
  await db.delete(events).where(eq(events.createdBy, publisherId))
  await db.delete(sessions).where(eq(sessions.publisherId, publisherId))
  await db.delete(magicLinkTokens).where(eq(magicLinkTokens.publisherId, publisherId))
  await db.delete(publishers).where(eq(publishers.id, publisherId))
  email.reset()
  await app.close()
})

describe('magic link login', () => {
  let cookie: string

  it('returns the same response for unknown emails and sends nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: `nobody-${stamp}@test.local` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.message).toMatch(/If this email is registered/)
    expect(outbox).toHaveLength(0)
  })

  it('sends a link for a registered email (case-insensitive)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: address.toUpperCase() },
    })
    expect(res.statusCode).toBe(200)
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.to).toBe(address)
    expect(outbox[0]!.url).toContain('/api/v1/auth/verify?token=')
  })

  it('verify sets a session cookie and redirects to the dashboard', async () => {
    const url = new URL(outbox[0]!.url)
    const res = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toMatch(/\/dashboard$/)
    const c = res.cookies.find((x) => x.name === 'oedb_session')
    expect(c).toBeDefined()
    expect(c!.httpOnly).toBe(true)
    cookie = `oedb_session=${c!.value}`
  })

  it('a magic link cannot be used twice', async () => {
    const url = new URL(outbox[0]!.url)
    const res = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toMatch(/login\?error=expired$/)
  })

  it('/auth/me resolves the session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ id: publisherId, email: address, auth_method: 'session', has_api_key: false })
  })

  it('a session can write and generate an API key', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie },
      payload: { title: 'Session event', starts_at: '2031-01-01T20:00:00Z', city: 'Testcity' },
    })
    expect(created.statusCode).toBe(201)

    const key = await app.inject({ method: 'POST', url: '/api/v1/publishers/me/api-key', headers: { cookie } })
    expect(key.statusCode).toBe(201)
    expect(key.json().data.api_key).toMatch(/^oevt_/)

    const viaKey = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${key.json().data.api_key}` },
    })
    expect(viaKey.statusCode).toBe(200)
    expect(viaKey.json().data.auth_method).toBe('api_key')
  })

  it('logout destroys the session', async () => {
    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } })
    expect(out.statusCode).toBe(200)
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })
    expect(me.statusCode).toBe(401)
  })

  it('rate-limits magic link requests per email', async () => {
    const target = `limited-${stamp}@test.local`
    const codes: number[] = []
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/magic-link', payload: { email: target } })
      codes.push(res.statusCode)
    }
    expect(codes).toEqual([200, 200, 200, 429])
  })
})
