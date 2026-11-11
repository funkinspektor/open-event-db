import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { inArray } from 'drizzle-orm'
import { generateToken, magicLinkTokens, sessions } from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { email } from '../email.js'
import { cleanupExpiredAuth } from '../cleanup.js'
import { cleanup, createAccount, createOrganizer } from '../test/fixtures.js'

let app: FastifyInstance
let accountId: string
let address: string
const stamp = Date.now()
const auth = (key: string) => ({ authorization: `Bearer ${key}` })
const outbox: { to: string; url: string }[] = []

beforeAll(async () => {
  email.setTransport({
    async sendMagicLink(msg) {
      outbox.push(msg)
    },
  })
  app = await buildApp({ logger: false })
  const { account } = await createAccount({ label: 'login' })
  accountId = account.id
  address = account.email
})

afterAll(async () => {
  await cleanup()
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
    // sent in the background, after the response
    await vi.waitFor(() => expect(outbox).toHaveLength(1))
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

  it('concurrent clicks on one magic link create only one session', async () => {
    const { token, hash } = generateToken()
    await db.insert(magicLinkTokens).values({
      accountId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const url = `/api/v1/auth/verify?token=${encodeURIComponent(token)}`
    const results = await Promise.all([1, 2, 3].map(() => app.inject({ method: 'GET', url })))
    const locations = results.map((r) => r.headers.location as string)
    expect(locations.filter((l) => l.endsWith('/dashboard'))).toHaveLength(1)
    expect(locations.filter((l) => l.endsWith('login?error=expired'))).toHaveLength(2)
  })

  it('/auth/me resolves the session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ id: accountId, email: address, auth_method: 'session', has_api_key: true })
  })

  it('a session can write and generate an API key', async () => {
    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/accounts/me',
      headers: { cookie },
      payload: { display_name: 'Session Writer' },
    })
    expect(updated.statusCode).toBe(200)

    const key = await app.inject({ method: 'POST', url: '/api/v1/accounts/me/api-key', headers: { cookie } })
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

  it('/auth/me lists verified and unverified memberships', async () => {
    const { account, key } = await createAccount()
    const extra = await createOrganizer([account.id], { verified: false })
    const res = await app.inject({ url: '/api/v1/auth/me', headers: auth(key) })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({
      handle: account.handle,
      is_scout: false,
      organizers: expect.arrayContaining([
        expect.objectContaining({ id: extra.id, verified: false, role: 'owner' }),
      ]),
    })
    expect(res.json().data.organizers).toHaveLength(2)
  })

  it('an account without rights may log in and read /auth/me', async () => {
    const { key } = await createAccount({ organizer: false })
    const res = await app.inject({ url: '/api/v1/auth/me', headers: auth(key) })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.organizers).toEqual([])
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

describe('auth cleanup', () => {
  it('removes expired and used magic-link tokens and expired sessions, keeps live ones', async () => {
    const now = Date.now()
    const tokenRows = await db
      .insert(magicLinkTokens)
      .values([
        { accountId, tokenHash: generateToken().hash, expiresAt: new Date(now - 1000) },
        { accountId, tokenHash: generateToken().hash, expiresAt: new Date(now + 60_000), usedAt: new Date() },
        { accountId, tokenHash: generateToken().hash, expiresAt: new Date(now + 60_000) },
      ])
      .returning({ id: magicLinkTokens.id })
    const sessionRows = await db
      .insert(sessions)
      .values([
        { accountId, tokenHash: generateToken().hash, expiresAt: new Date(now - 1000) },
        { accountId, tokenHash: generateToken().hash, expiresAt: new Date(now + 60_000) },
      ])
      .returning({ id: sessions.id })

    await cleanupExpiredAuth()

    const tokensLeft = await db
      .select({ id: magicLinkTokens.id })
      .from(magicLinkTokens)
      .where(inArray(magicLinkTokens.id, tokenRows.map((r) => r.id)))
    expect(tokensLeft.map((r) => r.id)).toEqual([tokenRows[2]!.id])
    const sessionsLeft = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(inArray(sessions.id, sessionRows.map((r) => r.id)))
    expect(sessionsLeft.map((r) => r.id)).toEqual([sessionRows[1]!.id])
  })
})
