import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { accounts, editHistory, generateToken, magicLinkTokens, sessions, sha256 } from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { email } from '../email.js'
import { cleanup, createAccount, createOrganizer } from '../test/fixtures.js'

let app: FastifyInstance
const mails: { to: string; url: string; kind: string; requesterHandle?: string }[] = []
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
    async sendEventLive() {},
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
  const { account } = await createAccount({ label: opts.label ?? 'self', organizer: false, onboarded: opts.onboarded })
  const s = generateToken()
  await db.insert(sessions).values({ accountId: account.id, tokenHash: s.hash, expiresAt: new Date(Date.now() + 3_600_000) })
  return { account, cookie: `oedb_session=${s.token}` }
}

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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

describe('before onboarding', () => {
  it('rejects calendar token and email change with 403 onboarding_required', async () => {
    const { cookie } = await sessionAccount({ onboarded: false })
    for (const [m, url, body] of [
      ['POST', '/accounts/me/calendar-token'],
      ['POST', '/accounts/me/email', { email: `new-${u()}@test.local` }],
    ] as const) {
      const res = await call(m, url, cookie, body)
      expect(res.statusCode, `${m} ${url}`).toBe(403)
      expect(res.json().error.code).toBe('onboarding_required')
    }
  })

  it('still allows /auth/me and deleting the account', async () => {
    const { account, cookie } = await sessionAccount({ onboarded: false })
    expect((await call('GET', '/auth/me', cookie)).statusCode).toBe(200)
    expect((await call('GET', '/accounts/me/delete-preview', cookie)).statusCode).toBe(200)
    const res = await call('DELETE', '/accounts/me', cookie, { confirm_handle: account.handle })
    expect(res.statusCode).toBe(200)
  })
})

describe('session-only', () => {
  it('rejects API keys and anonymous calls on every route', async () => {
    const { key } = await createAccount({ label: 'keyonly', organizer: false })
    const h = { authorization: `Bearer ${key}` }
    const routes: ['GET' | 'POST' | 'DELETE', string, unknown?][] = [
      ['POST', '/accounts/me/email/confirm', { token: 'x' }],
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

const tokenOf = (url: string) => new URL(url).searchParams.get('token')!

/** Requests an email change and waits for the (background) mail to the address. */
async function requestChange(cookie: string, address: string) {
  const res = await call('POST', '/accounts/me/email', cookie, { email: address })
  expect(res.statusCode).toBe(200)
  await vi.waitFor(() => expect(mails.some((m) => m.to === address.toLowerCase() && m.kind === 'email_change')).toBe(true))
  return mails.filter((m) => m.to === address.toLowerCase() && m.kind === 'email_change').at(-1)!
}

const confirm = (cookie: string | undefined, token: string) => call('POST', '/accounts/me/email/confirm', cookie, { token })

describe('email change', () => {
  it('sends the link to the web app, naming the requesting handle', async () => {
    const { account, cookie } = await sessionAccount()
    const mail = await requestChange(cookie, `web-${u()}@test.local`)
    expect(mail.url).toMatch(/\/confirm-email\?token=[A-Za-z0-9_-]+$/)
    expect(mail.url).not.toContain('/auth/verify')
    expect(mail.requesterHandle).toBe(account.handle)
  })

  it('never reveals a taken address; confirming then reports taken and changes nothing', async () => {
    const { account: other } = await sessionAccount()
    const { account, cookie } = await sessionAccount()
    const res = await call('POST', '/accounts/me/email', cookie, { email: other.email.toUpperCase() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { sent: true } })
    await vi.waitFor(() => expect(mails.some((m) => m.to === other.email.toLowerCase())).toBe(true))
    const mail = mails.filter((m) => m.to === other.email.toLowerCase()).at(-1)!
    expect(mail.kind).toBe('email_change')

    const done = await confirm(cookie, tokenOf(mail.url))
    expect(done.statusCode).toBe(200)
    expect(done.json()).toEqual({ data: { result: 'taken' } })
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
    await requestChange(cookie, fresh)
    const [t] = await db
      .select()
      .from(magicLinkTokens)
      .where(and(eq(magicLinkTokens.accountId, account.id), eq(magicLinkTokens.kind, 'email_change')))
    expect(t).toMatchObject({ email: fresh, newEmail: fresh })
    expect(t!.expiresAt.getTime() - Date.now()).toBeGreaterThan(23.5 * 3_600_000)
  })

  it('logs out other sessions and resets the calendar link, keeping the confirming session', async () => {
    const { account, cookie } = await sessionAccount()
    const other = generateToken()
    await db.insert(sessions).values({ accountId: account.id, tokenHash: other.hash, expiresAt: new Date(Date.now() + 3_600_000) })
    await call('POST', '/accounts/me/calendar-token', cookie)
    expect((await db.select().from(accounts).where(eq(accounts.id, account.id)))[0]!.calendarToken).not.toBeNull()
    const mail = await requestChange(cookie, `hardened-${u()}@test.local`)
    expect((await confirm(cookie, tokenOf(mail.url))).json()).toEqual({ data: { result: 'changed' } })
    expect((await call('GET', '/auth/me', cookie)).statusCode).toBe(200)
    expect((await call('GET', '/auth/me', `oedb_session=${other.token}`)).statusCode).toBe(401)
    const left = await db.select().from(sessions).where(eq(sessions.accountId, account.id))
    expect(left).toHaveLength(1)
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id))
    expect(row!.calendarToken).toBeNull()
  })

  it('a refused change (address taken) keeps other sessions and the calendar link', async () => {
    const { account, cookie } = await sessionAccount()
    const { account: taker } = await sessionAccount()
    const other = generateToken()
    await db.insert(sessions).values({ accountId: account.id, tokenHash: other.hash, expiresAt: new Date(Date.now() + 3_600_000) })
    await call('POST', '/accounts/me/calendar-token', cookie)
    const mail = await requestChange(cookie, taker.email)
    expect((await confirm(cookie, tokenOf(mail.url))).json()).toEqual({ data: { result: 'taken' } })
    expect((await call('GET', '/auth/me', `oedb_session=${other.token}`)).statusCode).toBe(200)
    expect((await db.select().from(accounts).where(eq(accounts.id, account.id)))[0]!.calendarToken).not.toBeNull()
  })

  it('applies a free address, notifies the old one, keeps the session and uses the link once', async () => {
    const { account, cookie } = await sessionAccount()
    const fresh = `changed-${u()}@test.local`
    notices.length = 0
    const mail = await requestChange(cookie, fresh)
    const done = await confirm(cookie, tokenOf(mail.url))
    expect(done.statusCode).toBe(200)
    expect(done.json()).toEqual({ data: { result: 'changed' } })
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id))
    expect(row!.email).toBe(fresh)
    expect(notices).toEqual([{ to: account.email, newEmail: fresh }])
    expect((await call('GET', '/auth/me', cookie)).json().data.email).toBe(fresh)

    const again = await confirm(cookie, tokenOf(mail.url))
    expect(again.statusCode).toBe(400)
    expect(again.json().error.code).toBe('invalid_token')
    expect(notices).toHaveLength(1)
  })

  it('refuses another account without consuming the token; the right account can still use it', async () => {
    const { account, cookie } = await sessionAccount()
    const { cookie: otherCookie } = await sessionAccount()
    const fresh = `owner-${u()}@test.local`
    const mail = await requestChange(cookie, fresh)
    const wrong = await confirm(otherCookie, tokenOf(mail.url))
    expect(wrong.statusCode).toBe(403)
    expect(wrong.json().error.code).toBe('wrong_account')
    const [t] = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.tokenHash, sha256(tokenOf(mail.url))))
    expect(t!.usedAt).toBeNull()
    const right = await confirm(cookie, tokenOf(mail.url))
    expect(right.json()).toEqual({ data: { result: 'changed' } })
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id))
    expect(row!.email).toBe(fresh)
  })

  it('requires a session and rejects unknown tokens', async () => {
    const { cookie } = await sessionAccount()
    const mail = await requestChange(cookie, `anon-${u()}@test.local`)
    expect((await confirm(undefined, tokenOf(mail.url))).statusCode).toBe(401)
    const unknown = await confirm(cookie, 'nope')
    expect(unknown.statusCode).toBe(400)
    expect(unknown.json().error.code).toBe('invalid_token')
    // still usable
    expect((await confirm(cookie, tokenOf(mail.url))).json()).toEqual({ data: { result: 'changed' } })
  })

  it('GET /auth/verify never applies an email_change token', async () => {
    const { account, cookie } = await sessionAccount()
    const fresh = `get-${u()}@test.local`
    const mail = await requestChange(cookie, fresh)
    const res = await app.inject({ method: 'GET', url: `/api/v1/auth/verify?token=${encodeURIComponent(tokenOf(mail.url))}` })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toMatch(/\/login\?error=invalid$/)
    expect(res.cookies.find((c) => c.name === 'oedb_session')).toBeUndefined()
    const [t] = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.tokenHash, sha256(tokenOf(mail.url))))
    expect(t!.usedAt).toBeNull()
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id))
    expect(row!.email).toBe(account.email)
  })

  it('a link requested earlier dies when a newer one is requested', async () => {
    const { account, cookie } = await sessionAccount()
    const first = await requestChange(cookie, `first-${u()}@test.local`)
    const second = await requestChange(cookie, `second-${u()}@test.local`)
    const old = await confirm(cookie, tokenOf(first.url))
    expect(old.statusCode).toBe(400)
    expect((await confirm(cookie, tokenOf(second.url))).json()).toEqual({ data: { result: 'changed' } })
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id))
    expect(row!.email).toBe(second.to)
  })

  it('kills unused login links of the old address', async () => {
    const { account, cookie } = await sessionAccount()
    const oldLogin = generateToken()
    await db
      .insert(magicLinkTokens)
      .values({ accountId: account.id, email: account.email, tokenHash: oldLogin.hash, expiresAt: new Date(Date.now() + 600_000) })
    const mail = await requestChange(cookie, `moved-${u()}@test.local`)
    await confirm(cookie, tokenOf(mail.url))
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

  it('a deleted account can no longer confirm (token gone)', async () => {
    const { account, cookie } = await sessionAccount()
    const { cookie: otherCookie } = await sessionAccount()
    const mail = await requestChange(cookie, `late-${u()}@test.local`)
    await call('DELETE', '/accounts/me', cookie, { confirm_handle: account.handle })
    const res = await confirm(otherCookie, tokenOf(mail.url))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('invalid_token')
  })

  it('allows 3 requests per hour per account, the 4th gets 429', async () => {
    const { cookie } = await sessionAccount()
    for (let i = 0; i < 3; i++) {
      expect((await call('POST', '/accounts/me/email', cookie, { email: `rl-${i}-${u()}@test.local` })).statusCode).toBe(200)
    }
    const res = await call('POST', '/accounts/me/email', cookie, { email: `rl-4-${u()}@test.local` })
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe('rate_limited')
  })

  it('allows 3 requests per hour per target address across accounts, the 4th gets 429', async () => {
    const target = `bomb-${u()}@test.local`
    for (let i = 0; i < 3; i++) {
      const { cookie } = await sessionAccount()
      expect((await call('POST', '/accounts/me/email', cookie, { email: i === 1 ? target.toUpperCase() : target })).statusCode).toBe(200)
    }
    const { cookie } = await sessionAccount()
    const res = await call('POST', '/accounts/me/email', cookie, { email: target })
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe('rate_limited')
  })

  it('a transport error does not fail the request', async () => {
    const { cookie } = await sessionAccount()
    const saved = email.transport
    email.setTransport({
      async sendMagicLink() {
        throw new Error('boom')
      },
      async sendEmailChangedNotice() {},
      async sendEventLive() {},
    })
    try {
      const res = await call('POST', '/accounts/me/email', cookie, { email: `fail-${u()}@test.local` })
      expect(res.statusCode).toBe(200)
    } finally {
      email.setTransport(saved)
    }
  })
})

describe('reserved handles', () => {
  const reserved = ['deleted-00000000-0000-0000-0000-000000000000', 'deleted-x', 'new-abcd1234']

  it('onboarding rejects them with 400 handle_reserved', async () => {
    const { cookie } = await sessionAccount({ onboarded: false })
    for (const handle of reserved) {
      const res = await call('POST', '/accounts/me/onboarding', cookie, { display_name: 'Kim', handle, accept_terms: true })
      expect(res.statusCode, handle).toBe(400)
      expect(res.json().error.code).toBe('handle_reserved')
    }
    // a similar but non-provisional handle is fine
    const ok = await call('POST', '/accounts/me/onboarding', cookie, { display_name: 'Kim', handle: `new-abcd12345-${u()}`, accept_terms: true })
    expect(ok.statusCode).toBe(200)
  })

  it('PUT /accounts/me rejects them with 400 handle_reserved', async () => {
    const { cookie } = await sessionAccount()
    for (const handle of reserved) {
      const res = await call('PUT', '/accounts/me', cookie, { handle })
      expect(res.statusCode, handle).toBe(400)
      expect(res.json().error.code).toBe('handle_reserved')
    }
  })

  it('check-handle reports them unavailable', async () => {
    for (const handle of reserved) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/accounts/check-handle?handle=${handle}` })
      expect(res.json().data.available, handle).toBe(false)
    }
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

    expect((await call('GET', '/accounts/me/calendar', cookie)).headers['cache-control']).toBe('private, no-store')

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
