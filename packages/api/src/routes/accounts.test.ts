import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { accounts, editHistory, generateToken, magicLinkTokens, sessions } from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { email } from '../email.js'
import { cleanup, createAccount, createOrganizer } from '../test/fixtures.js'

let app: FastifyInstance
const mails: { to: string; url: string; kind: string }[] = []
const notices: { to: string; newEmail: string }[] = []
const u = () => Math.random().toString(36).slice(2, 8)

beforeAll(async () => {
  email.setTransport({
    async sendMagicLink(msg) {
      mails.push(msg)
    },
    async sendEmailChangedNotice(msg) {
      notices.push(msg)
    },
  })
  app = await buildApp({ logger: false })
})

afterAll(async () => {
  await cleanup()
  email.reset()
  await app.close()
})

/** A browser session for a fresh account, optionally not yet onboarded. */
async function sessionAccount(opts: { onboarded?: boolean; label?: string } = {}) {
  const { account } = await createAccount({ label: opts.label ?? 'self', organizer: false })
  if (opts.onboarded !== false) await db.update(accounts).set({ onboardedAt: new Date() }).where(eq(accounts.id, account.id))
  const s = generateToken()
  await db.insert(sessions).values({ accountId: account.id, tokenHash: s.hash, expiresAt: new Date(Date.now() + 3_600_000) })
  return { account, cookie: `oedb_session=${s.token}` }
}

const call = (
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  cookie?: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
    payload: payload as never,
  })

const pathOf = (url: string) => {
  const x = new URL(url)
  return `${x.pathname}${x.search}`
}

describe('session-only', () => {
  it('rejects API keys and anonymous calls on every route', async () => {
    const { key } = await createAccount({ label: 'keyonly', organizer: false })
    const h = { authorization: `Bearer ${key}` }
    const routes: ['GET' | 'POST' | 'DELETE', string, unknown?][] = [
      ['POST', '/accounts/me/onboarding', { display_name: 'A', handle: 'a-a-a', accept_terms: true }],
      ['POST', '/accounts/me/email', { email: 'x@y.test' }],
      ['GET', '/accounts/me/delete-preview'],
      ['DELETE', '/accounts/me', { confirm_handle: 'x' }],
      ['POST', '/accounts/me/calendar-token'],
      ['GET', '/accounts/me/calendar'],
    ]
    for (const [m, url, body] of routes) {
      expect((await call(m, url, undefined, body, h)).statusCode, `${m} ${url} key`).toBe(403)
      expect((await call(m, url, undefined, body)).statusCode, `${m} ${url} anon`).toBe(401)
    }
  })
})

describe('onboarding', () => {
  it('sets name, handle and both timestamps and returns AccountMe', async () => {
    const { account, cookie } = await sessionAccount({ onboarded: false })
    const handle = `onb-${u()}`
    const res = await call('POST', '/accounts/me/onboarding', cookie, { display_name: '  Kim  ', handle, accept_terms: true })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ id: account.id, handle, display_name: 'Kim', onboarded: true })
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id))
    expect(row!.onboardedAt).not.toBeNull()
    expect(row!.termsAcceptedAt).not.toBeNull()
  })

  it('requires the terms', async () => {
    const { account, cookie } = await sessionAccount({ onboarded: false })
    for (const accept_terms of [false, undefined]) {
      const res = await call('POST', '/accounts/me/onboarding', cookie, { display_name: 'Kim', handle: `t-${u()}`, accept_terms })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('terms_required')
    }
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id))
    expect(row!.onboardedAt).toBeNull()
  })

  it('rejects a taken handle with 400 handle_taken', async () => {
    const { account: other } = await sessionAccount()
    const { cookie } = await sessionAccount({ onboarded: false })
    const res = await call('POST', '/accounts/me/onboarding', cookie, { display_name: 'Kim', handle: other.handle, accept_terms: true })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('handle_taken')
  })

  it('rejects a second onboarding with 409 already_onboarded and changes nothing', async () => {
    const { account, cookie } = await sessionAccount()
    const res = await call('POST', '/accounts/me/onboarding', cookie, { display_name: 'Other', handle: `x-${u()}`, accept_terms: true })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('already_onboarded')
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id))
    expect(row!.handle).toBe(account.handle)
  })

  it('allows keeping the own provisional handle', async () => {
    const { account, cookie } = await sessionAccount({ onboarded: false })
    const res = await call('POST', '/accounts/me/onboarding', cookie, { display_name: 'Kim', handle: account.handle, accept_terms: true })
    expect(res.statusCode).toBe(200)
  })
})

describe('email change', () => {
  it('never reveals a taken address and the click then redirects to ?email=taken', async () => {
    const { account: other } = await sessionAccount()
    const { account, cookie } = await sessionAccount()
    mails.length = 0
    const res = await call('POST', '/accounts/me/email', cookie, { email: other.email.toUpperCase() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { sent: true } })
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({ to: other.email.toLowerCase(), kind: 'email_change' })

    const click = await app.inject({ method: 'GET', url: pathOf(mails[0]!.url) })
    expect(click.statusCode).toBe(302)
    expect(click.headers.location).toMatch(/\/profile\?email=taken$/)
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id))
    expect(row!.email).toBe(account.email)
    const [o] = await db.select().from(accounts).where(eq(accounts.id, other.id))
    expect(o!.email).toBe(other.email)
  })

  it('stores the new address on the token and rejects the own address', async () => {
    const { account, cookie } = await sessionAccount()
    const same = await call('POST', '/accounts/me/email', cookie, { email: account.email.toUpperCase() })
    expect(same.statusCode).toBe(400)
    expect(same.json().error.code).toBe('same_email')
    const fresh = `new-${u()}@test.local`
    mails.length = 0
    await call('POST', '/accounts/me/email', cookie, { email: fresh })
    const [t] = await db
      .select()
      .from(magicLinkTokens)
      .where(and(eq(magicLinkTokens.accountId, account.id), eq(magicLinkTokens.kind, 'email_change')))
    expect(t).toMatchObject({ email: fresh, newEmail: fresh })
    expect(t!.expiresAt.getTime() - Date.now()).toBeGreaterThan(23.5 * 3_600_000)
  })

  it('applies a free address, notifies the old one, keeps sessions and uses the link once', async () => {
    const { account, cookie } = await sessionAccount()
    const fresh = `changed-${u()}@test.local`
    mails.length = 0
    notices.length = 0
    await call('POST', '/accounts/me/email', cookie, { email: fresh })
    const link = pathOf(mails[0]!.url)
    const click = await app.inject({ method: 'GET', url: link })
    expect(click.headers.location).toMatch(/\/profile\?email=changed$/)
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id))
    expect(row!.email).toBe(fresh)
    expect(notices).toEqual([{ to: account.email, newEmail: fresh }])
    expect((await call('GET', '/auth/me', cookie)).json().data.email).toBe(fresh)

    const again = await app.inject({ method: 'GET', url: link })
    expect(again.headers.location).toMatch(/login\?error=expired$/)
    expect(notices).toHaveLength(1)
  })

  it('a link requested earlier dies when another address wins', async () => {
    const { account, cookie } = await sessionAccount()
    mails.length = 0
    await call('POST', '/accounts/me/email', cookie, { email: `first-${u()}@test.local` })
    await call('POST', '/accounts/me/email', cookie, { email: `second-${u()}@test.local` })
    const [first, second] = mails
    expect((await app.inject({ method: 'GET', url: pathOf(second!.url) })).headers.location).toMatch(/email=changed$/)
    const old = await app.inject({ method: 'GET', url: pathOf(first!.url) })
    expect(old.headers.location).toMatch(/login\?error=expired$/)
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id))
    expect(row!.email).toBe(second!.to)
  })

  it('kills unused login links of the old address', async () => {
    const { account, cookie } = await sessionAccount()
    const oldLogin = generateToken()
    await db
      .insert(magicLinkTokens)
      .values({ accountId: account.id, email: account.email, tokenHash: oldLogin.hash, expiresAt: new Date(Date.now() + 600_000) })
    const fresh = `moved-${u()}@test.local`
    mails.length = 0
    await call('POST', '/accounts/me/email', cookie, { email: fresh })
    await app.inject({ method: 'GET', url: pathOf(mails[0]!.url) })
    const unused = await db
      .select()
      .from(magicLinkTokens)
      .where(and(eq(magicLinkTokens.accountId, account.id), eq(magicLinkTokens.kind, 'login'), isNull(magicLinkTokens.usedAt)))
    expect(unused).toHaveLength(0)
    const res = await app.inject({ method: 'GET', url: `/api/v1/auth/verify?token=${encodeURIComponent(oldLogin.token)}` })
    expect(res.headers.location).toMatch(/login\?error=expired$/)
    expect(res.cookies.find((c) => c.name === 'oedb_session')).toBeUndefined()
  })

  it('verify refuses a login token whose address is no longer the account address', async () => {
    const { account } = await sessionAccount()
    const stale = generateToken()
    await db
      .insert(magicLinkTokens)
      .values({ accountId: account.id, email: `gone-${u()}@test.local`, tokenHash: stale.hash, expiresAt: new Date(Date.now() + 600_000) })
    const bad = await app.inject({ method: 'GET', url: `/api/v1/auth/verify?token=${encodeURIComponent(stale.token)}` })
    expect(bad.headers.location).toMatch(/login\?error=expired$/)
    expect(bad.cookies.find((c) => c.name === 'oedb_session')).toBeUndefined()
    const good = generateToken()
    await db
      .insert(magicLinkTokens)
      .values({ accountId: account.id, email: account.email.toUpperCase(), tokenHash: good.hash, expiresAt: new Date(Date.now() + 600_000) })
    const ok = await app.inject({ method: 'GET', url: `/api/v1/auth/verify?token=${encodeURIComponent(good.token)}` })
    expect(ok.headers.location).toMatch(/\/dashboard$/)
  })

  it('redirects to expired when the account was deleted meanwhile', async () => {
    const { account, cookie } = await sessionAccount()
    mails.length = 0
    await call('POST', '/accounts/me/email', cookie, { email: `late-${u()}@test.local` })
    await call('DELETE', '/accounts/me', cookie, { confirm_handle: account.handle })
    const res = await app.inject({ method: 'GET', url: pathOf(mails[0]!.url) })
    expect(res.headers.location).toMatch(/login\?error=expired$/)
  })

  it('is rate limited', async () => {
    const { cookie } = await sessionAccount()
    let last = 0
    for (let i = 0; i < 35; i++) {
      last = (await call('POST', '/accounts/me/email', cookie, { email: `rl-${i}-${u()}@test.local` })).statusCode
    }
    expect(last).toBe(429)
  })
})

describe('account deletion', () => {
  it('previews organizers that would be left without members', async () => {
    const { account, cookie } = await sessionAccount()
    const sole = await createOrganizer([account.id])
    const { account: other } = await sessionAccount()
    await createOrganizer([account.id, other.id])
    const res = await call('GET', '/accounts/me/delete-preview', cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.orphaned_organizers).toEqual([{ id: sole.id, name: sole.name, slug: sole.slug }])
  })

  it('refuses a wrong handle', async () => {
    const { account, cookie } = await sessionAccount()
    const res = await call('DELETE', '/accounts/me', cookie, { confirm_handle: `${account.handle}x` })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('confirm_mismatch')
    expect((await call('GET', '/auth/me', cookie)).statusCode).toBe(200)
  })

  it('deletes, clears the cookie, drops the session and logs via self', async () => {
    const { account, cookie } = await sessionAccount()
    const res = await call('DELETE', '/accounts/me', cookie, { confirm_handle: account.handle })
    expect(res.statusCode).toBe(200)
    const c = res.cookies.find((x) => x.name === 'oedb_session')
    expect(c?.value).toBe('')
    expect((await call('GET', '/auth/me', cookie)).statusCode).toBe(401)
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id))
    expect(row!.handle).toBe(`deleted-${account.id}`)
    const [h] = await db
      .select()
      .from(editHistory)
      .where(and(eq(editHistory.entityId, account.id), eq(editHistory.action, 'deleted')))
    expect(h!.diff).toEqual({ via: 'self' })
    expect(
      await db.select().from(magicLinkTokens).where(sql`lower(${magicLinkTokens.email}) = ${account.email.toLowerCase()}`),
    ).toHaveLength(0)
  })
})

describe('calendar token', () => {
  it('creates, shows and rotates the feed URL', async () => {
    const { account, cookie } = await sessionAccount()
    expect((await call('GET', '/accounts/me/calendar', cookie)).json()).toEqual({ data: { url: null } })
    expect((await call('GET', '/auth/me', cookie)).json().data.has_calendar).toBe(false)

    const a = await call('POST', '/accounts/me/calendar-token', cookie)
    expect(a.statusCode).toBe(200)
    const urlA = a.json().data.url as string
    expect(urlA).toMatch(/\/cal\/[A-Za-z0-9_-]{43}\.ics$/)
    expect((await call('GET', '/accounts/me/calendar', cookie)).json().data.url).toBe(urlA)
    expect((await call('GET', '/auth/me', cookie)).json().data.has_calendar).toBe(true)

    const b = await call('POST', '/accounts/me/calendar-token', cookie)
    const urlB = b.json().data.url as string
    expect(urlB).not.toBe(urlA)
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id))
    expect(urlB).toBe(`${process.env.API_PUBLIC_URL ?? 'http://localhost:3001'}/cal/${row!.calendarToken}.ics`)
  })
})
