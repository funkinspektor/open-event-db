import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { inArray } from 'drizzle-orm'
import { and, eq, like } from 'drizzle-orm'
import { accounts, deleteAccount, generateToken, magicLinkTokens, sessions } from '@open-event-db/db'
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
const outbox: { to: string; url: string; kind: string }[] = []

beforeAll(async () => {
  email.setTransport({
    async sendMagicLink(msg) {
      outbox.push(msg)
    },
    async sendEmailChangedNotice() {},
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
      email: address,
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

  it('sends a magic link to an account without any rights', async () => {
    const { account } = await createAccount({ organizer: false })
    const before = outbox.length
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/magic-link', payload: { email: account.email } })
    expect(res.statusCode).toBe(200)
    await vi.waitFor(() => expect(outbox.length).toBe(before + 1))
    expect(outbox[before]!.to).toBe(account.email)
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
        { accountId, email: address, tokenHash: generateToken().hash, expiresAt: new Date(now - 1000) },
        { accountId, email: address, tokenHash: generateToken().hash, expiresAt: new Date(now + 60_000), usedAt: new Date() },
        { accountId, email: address, tokenHash: generateToken().hash, expiresAt: new Date(now + 60_000) },
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

describe('sign-up through the magic link', () => {
  // Each request comes from its own address unless a test pins one: the per-IP cap must not leak between tests/runs.
  const randomIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`
  const requestLink = (address: string, extra: Record<string, unknown> = {}, ip: string = randomIp()) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: address, ...extra },
      remoteAddress: ip,
    })
  const click = (url: string) => {
    const u = new URL(url)
    return app.inject({ method: 'GET', url: `${u.pathname}${u.search}` })
  }
  const byAddress = async (address: string) =>
    db.select().from(accounts).where(eq(accounts.email, address))
  const created: string[] = []
  afterAll(async () => {
    if (created.length) await db.delete(accounts).where(inArray(accounts.email, created))
    await db.delete(magicLinkTokens).where(like(magicLinkTokens.email, `%-${stamp}%@test.local`))
  })

  it('answers unknown and known addresses identically and mails a sign-up link', async () => {
    const fresh = `signup-${stamp}-a@test.local`
    const before = outbox.length
    const unknown = await requestLink(fresh)
    const known = await requestLink(address)
    expect(unknown.statusCode).toBe(200)
    expect(unknown.json()).toEqual(known.json())
    await vi.waitFor(() => expect(outbox.length).toBe(before + 2))
    // both are sent in the background, so the order is not fixed
    const sent = outbox.slice(before)
    expect(sent.find((m) => m.to === fresh)).toMatchObject({ kind: 'signup' })
    expect(sent.find((m) => m.to === address)).toMatchObject({ kind: 'login' })
    expect(await byAddress(fresh)).toHaveLength(0)
  })

  it('creating the account happens on click: provisional handle, not onboarded, return_to honoured', async () => {
    const fresh = `signup-${stamp}-b@test.local`
    created.push(fresh)
    const before = outbox.length
    await requestLink(fresh, { return_to: '/events/x?interest=1' })
    await vi.waitFor(() => expect(outbox.length).toBe(before + 1))
    const [tok] = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.email, fresh))
    expect(tok).toMatchObject({ kind: 'signup', accountId: null, returnTo: '/events/x?interest=1' })

    const res = await click(outbox[before]!.url)
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toMatch(/\/events\/x\?interest=1$/)
    const rows = await byAddress(fresh)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.handle).toMatch(/^new-[a-z0-9]{8}$/)
    expect(rows[0]!.displayName).toBe('')
    expect(rows[0]!.onboardedAt).toBeNull()

    const c = res.cookies.find((x) => x.name === 'oedb_session')!
    const me = await app.inject({ url: '/api/v1/auth/me', headers: { cookie: `oedb_session=${c.value}` } })
    expect(me.json().data).toMatchObject({ email: fresh, onboarded: false, has_calendar: false })
  })

  it('two sign-up links for one address yield one account and two sessions', async () => {
    const fresh = `signup-${stamp}-c@test.local`
    created.push(fresh)
    const before = outbox.length
    await requestLink(fresh)
    await requestLink(fresh)
    await vi.waitFor(() => expect(outbox.length).toBe(before + 2))
    const [r1, r2] = [await click(outbox[before]!.url), await click(outbox[before + 1]!.url)]
    expect(r1.headers.location).toMatch(/\/dashboard$/)
    expect(r2.headers.location).toMatch(/\/dashboard$/)
    const rows = await byAddress(fresh)
    expect(rows).toHaveLength(1)
    const sess = await db.select().from(sessions).where(eq(sessions.accountId, rows[0]!.id))
    expect(sess).toHaveLength(2)
  })

  it('a deleted account can sign up again with a fresh account', async () => {
    const fresh = `signup-${stamp}-d@test.local`
    created.push(fresh)
    let before = outbox.length
    await requestLink(fresh)
    await vi.waitFor(() => expect(outbox.length).toBe(before + 1))
    await click(outbox[before]!.url)
    const [first] = await byAddress(fresh)
    await deleteAccount(db, first!.id)
    expect(await byAddress(fresh)).toHaveLength(0)

    before = outbox.length
    await requestLink(fresh)
    await vi.waitFor(() => expect(outbox.length).toBe(before + 1))
    expect(outbox[before]!.kind).toBe('signup')
    await click(outbox[before]!.url)
    const [second] = await byAddress(fresh)
    expect(second).toBeDefined()
    expect(second!.id).not.toBe(first!.id)
  })

  it('drops an unsafe return_to', async () => {
    const fresh = `signup-${stamp}-e@test.local`
    created.push(fresh)
    const before = outbox.length
    await requestLink(fresh, { return_to: '//evil.example' })
    await vi.waitFor(() => expect(outbox.length).toBe(before + 1))
    const res = await click(outbox[before]!.url)
    expect(res.headers.location).toMatch(/\/dashboard$/)
    expect(res.headers.location).not.toContain('evil')
  })

  it('does not send the 11th sign-up mail from one IP in a day, response unchanged', async () => {
    const ip = '203.0.113.77'
    await db.delete(magicLinkTokens).where(eq(magicLinkTokens.requestIp, ip))
    const before = outbox.length
    const bodies: unknown[] = []
    for (let i = 0; i < 11; i++) {
      const res = await requestLink(`cap-${stamp}-${i}@test.local`, {}, ip)
      expect(res.statusCode).toBe(200)
      bodies.push(res.json())
    }
    await vi.waitFor(() => expect(outbox.length).toBe(before + 10))
    await new Promise((r) => setTimeout(r, 100))
    expect(outbox.length).toBe(before + 10)
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1)
    const rows = await db
      .select()
      .from(magicLinkTokens)
      .where(and(eq(magicLinkTokens.kind, 'signup'), eq(magicLinkTokens.requestIp, ip)))
    expect(rows).toHaveLength(10)
    await db.delete(magicLinkTokens).where(eq(magicLinkTokens.requestIp, ip))
  })

  it('15 parallel sign-up requests from one IP create exactly 10 tokens and mails', async () => {
    const ip = '203.0.113.99'
    await db.delete(magicLinkTokens).where(eq(magicLinkTokens.requestIp, ip))
    const before = outbox.length
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => requestLink(`par-${stamp}-${i}@test.local`, {}, ip)),
    )
    expect(results.every((r) => r.statusCode === 200)).toBe(true)
    await vi.waitFor(() => expect(outbox.length).toBeGreaterThanOrEqual(before + 10))
    await new Promise((r) => setTimeout(r, 300))
    expect(outbox.length).toBe(before + 10)
    const rows = await db
      .select()
      .from(magicLinkTokens)
      .where(and(eq(magicLinkTokens.kind, 'signup'), eq(magicLinkTokens.requestIp, ip)))
    expect(rows).toHaveLength(10)
    await db.delete(magicLinkTokens).where(eq(magicLinkTokens.requestIp, ip))
  })

  it.each([[123], ['/x'.repeat(1500)], [{ a: 1 }]])('a junk return_to never causes a 400 and is dropped', async (junk) => {
    const fresh = `signup-${stamp}-junk${typeof junk}${String(junk).length}@test.local`
    const before = outbox.length
    const res = await requestLink(fresh, { return_to: junk })
    expect(res.statusCode).toBe(200)
    await vi.waitFor(() => expect(outbox.length).toBe(before + 1))
    const [tok] = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.email, fresh))
    expect(tok!.returnTo).toBeNull()
  })

  it('cleanup keeps sign-up tokens for 24h (for the per-IP cap), other kinds as before', async () => {
    const now = Date.now()
    const ip = '203.0.113.88'
    const mk = (kind: 'signup' | 'login', createdAgoMs: number) => ({
      accountId: kind === 'login' ? accountId : null,
      email: kind === 'login' ? address : `keep-${stamp}@test.local`,
      kind,
      requestIp: ip,
      tokenHash: generateToken().hash,
      createdAt: new Date(now - createdAgoMs),
      expiresAt: new Date(now - createdAgoMs + 15 * 60_000),
    })
    const rows = await db
      .insert(magicLinkTokens)
      .values([mk('signup', 3_600_000), mk('signup', 25 * 3_600_000), mk('login', 3_600_000)])
      .returning({ id: magicLinkTokens.id })
    await cleanupExpiredAuth()
    const left = await db
      .select({ id: magicLinkTokens.id })
      .from(magicLinkTokens)
      .where(inArray(magicLinkTokens.id, rows.map((r) => r.id)))
    expect(left.map((r) => r.id)).toEqual([rows[0]!.id])
    await db.delete(magicLinkTokens).where(eq(magicLinkTokens.requestIp, ip))
  })
})
