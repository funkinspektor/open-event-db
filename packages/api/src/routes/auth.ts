import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomInt } from 'node:crypto'
import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { magicLinkRequestSchema, safeReturnTo, type AccountMe } from '@open-event-db/shared'
import { generateToken, accounts, magicLinkTokens, organizerMembers, organizers, sessions, sha256 } from '@open-event-db/db'
import { db } from '../db.js'
import { email, type MagicLinkKind } from '../email.js'
import { ApiError, unauthorized } from '../errors.js'
import { SESSION_COOKIE, SESSION_TTL_MS, authenticate, type AuthAccount, type AuthMethod } from '../auth.js'

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000'
export const API_PUBLIC_URL = process.env.API_PUBLIC_URL ?? 'http://localhost:3001'
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000
const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000
const SIGNUP_CAP_WINDOW_MS = 24 * 60 * 60 * 1000
const MAGIC_LINK_IP_LIMIT = Number(process.env.MAGIC_LINK_IP_LIMIT) || 20
const MAGIC_LINK_IP_WINDOW_MS = 60 * 60 * 1000
const SIGNUP_MAILS_PER_IP_PER_DAY = Number(process.env.SIGNUP_MAILS_PER_IP_PER_DAY) || 10

// In production web and API run on sibling subdomains (kellerkompass.de / api.kellerkompass.de), so the
// cookie needs COOKIE_DOMAIN=kellerkompass.de for the web server to see it. Locally host-only is fine.
export const cookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  domain: process.env.COOKIE_DOMAIN || undefined,
}

const magicLinkRateLimit = {
  max: 3,
  timeWindow: '1 hour',
  keyGenerator: (req: FastifyRequest) => {
    const body = req.body as { email?: unknown } | undefined
    return typeof body?.email === 'string' ? `magic:${body.email.trim().toLowerCase()}` : req.ip
  },
}

export interface SendMagicLinkInput {
  kind: MagicLinkKind
  /** The address the link is sent to (for email_change: the new address). */
  to: string
  /** Null for sign-up links: the account is created when the link is used. */
  accountId: string | null
  returnTo?: string | null
  newEmail?: string
  requestIp?: string
  /** email_change: the handle of the requesting account, named in the mail. */
  requesterHandle?: string
}

/** Stores a token and returns the link URL. Pass `tx` to run inside a transaction. */
async function insertToken(input: SendMagicLinkInput, tx: Pick<typeof db, 'insert'> = db): Promise<string> {
  const { token, hash } = generateToken()
  const ttl = input.kind === 'email_change' ? EMAIL_CHANGE_TTL_MS : MAGIC_LINK_TTL_MS
  await tx.insert(magicLinkTokens).values({
    accountId: input.accountId,
    email: input.to,
    kind: input.kind,
    returnTo: input.returnTo ?? null,
    newEmail: input.newEmail ?? null,
    requestIp: input.requestIp ?? null,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + ttl),
  })
  // Email-change links open a web page that confirms with a POST from a logged-in session; a plain GET
  // (a mail scanner, someone else clicking) must never bind an address to an account.
  if (input.kind === 'email_change') return `${WEB_URL}/confirm-email?token=${encodeURIComponent(token)}`
  return `${API_PUBLIC_URL}/api/v1/auth/verify?token=${encodeURIComponent(token)}`
}

export async function sendMagicLink(input: SendMagicLinkInput): Promise<void> {
  const url = await insertToken(input)
  await email.transport.sendMagicLink({ to: input.to, url, kind: input.kind, requesterHandle: input.requesterHandle })
}

/**
 * Sign-up link for an unknown address, subject to the per-IP daily cap. Count and insert run in one
 * transaction under an advisory lock per IP, so parallel requests cannot all slip under the cap.
 * Sends nothing when the cap is reached.
 */
// Sliding-window request limit per client IP for the magic-link route, identical for known and unknown
// addresses. It bounds the background work (each unknown-address request holds a DB connection while it waits
// on its IP's advisory lock). In memory is enough because the API runs as a single instance; with several
// instances the limit would be per instance. Timestamps older than the window are pruned on access and
// empty keys dropped, so memory stays bounded by the requests of the last hour.
const magicLinkHits = new Map<string, number[]>()

/** Records a request from `ip`; returns false when it is over the limit. */
export function allowMagicLinkRequest(ip: string, now = Date.now()): boolean {
  const recent = (magicLinkHits.get(ip) ?? []).filter((t) => now - t < MAGIC_LINK_IP_WINDOW_MS)
  if (recent.length >= MAGIC_LINK_IP_LIMIT) {
    magicLinkHits.set(ip, recent)
    return false
  }
  recent.push(now)
  magicLinkHits.set(ip, recent)
  // Occasionally sweep other IPs so keys that are never seen again don't accumulate.
  if (magicLinkHits.size > 1000) {
    for (const [key, times] of magicLinkHits) {
      if (times.every((t) => now - t >= MAGIC_LINK_IP_WINDOW_MS)) magicLinkHits.delete(key)
    }
  }
  return true
}

async function sendSignupLink(address: string, returnTo: string | null, ip: string): Promise<void> {
  const url = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'signup-cap:' + ip}))`)
    const [row] = await tx
      .select({ n: count() })
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.kind, 'signup'),
          eq(magicLinkTokens.requestIp, ip),
          gt(magicLinkTokens.createdAt, new Date(Date.now() - SIGNUP_CAP_WINDOW_MS)),
        ),
      )
    if ((row?.n ?? 0) >= SIGNUP_MAILS_PER_IP_PER_DAY) return null
    return insertToken({ kind: 'signup', to: address, accountId: null, returnTo, requestIp: ip }, tx)
  })
  if (url) await email.transport.sendMagicLink({ to: address, url, kind: 'signup' })
}

const HANDLE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const provisionalHandle = () =>
  `new-${Array.from({ length: 8 }, () => HANDLE_ALPHABET[randomInt(HANDLE_ALPHABET.length)]).join('')}`

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null
  return e?.code === '23505' || e?.cause?.code === '23505'
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The account for a sign-up link: an existing one if the address got registered meanwhile, else a new one. */
async function accountForSignup(tx: Tx, address: string): Promise<string> {
  const find = async () => {
    const [a] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(sql`lower(${accounts.email}) = ${address.toLowerCase()}`)
      .limit(1)
    return a?.id
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await find()
    if (existing) return existing
    try {
      // A savepoint: a handle collision must not abort the surrounding transaction.
      const created = await tx.transaction(async (sp) => {
        const [row] = await sp
          .insert(accounts)
          .values({ email: address.toLowerCase(), handle: provisionalHandle(), displayName: '' })
          .onConflictDoNothing({ target: accounts.email })
          .returning({ id: accounts.id })
        return row?.id
      })
      if (created) return created
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      // handle collision: retry with a new random suffix
    }
  }
  throw new Error('could not create an account for the sign-up link')
}

/** The /auth/me payload: the account with all its memberships, verified or not (the settings page lists both). */
export async function accountMe(
  a: Pick<AuthAccount, 'id' | 'email' | 'handle' | 'displayName' | 'isScout' | 'apiKeyHash' | 'onboardedAt' | 'calendarToken'>,
  authMethod: AuthMethod,
): Promise<AccountMe> {
  const memberships = await db
    .select({
      id: organizers.id,
      name: organizers.name,
      slug: organizers.slug,
      role: organizerMembers.role,
      verified: organizers.verified,
    })
    .from(organizerMembers)
    .innerJoin(organizers, eq(organizers.id, organizerMembers.organizerId))
    .where(eq(organizerMembers.accountId, a.id))
    .orderBy(asc(organizers.name), asc(organizers.id))
  return {
    id: a.id,
    email: a.email,
    handle: a.handle,
    display_name: a.displayName,
    is_scout: a.isScout,
    has_api_key: a.apiKeyHash !== null,
    auth_method: authMethod,
    onboarded: a.onboardedAt !== null,
    has_calendar: a.calendarToken !== null,
    organizers: memberships,
  }
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/magic-link', { config: { rateLimit: magicLinkRateLimit } }, async (req, reply) => {
    // Before any DB work, and the same for every address.
    if (!allowMagicLinkRequest(req.ip)) {
      void reply.header('retry-after', String(MAGIC_LINK_IP_WINDOW_MS / 1000))
      throw new ApiError(429, 'rate_limited', 'Rate limit exceeded, retry later')
    }
    const { email: address, return_to } = magicLinkRequestSchema.parse(req.body)
    const normalized = address.toLowerCase()
    const returnTo = safeReturnTo(return_to)
    const ip = req.ip

    const [account] = await db
      .select()
      .from(accounts)
      .where(sql`lower(${accounts.email}) = ${normalized}`)
      .limit(1)

    // The request path only does the account lookup. Everything else (cap check, token insert, mail) runs in
    // the background for both branches, so neither the response nor its timing reveals whether the email is
    // registered, and a capped IP is indistinguishable from an uncapped one.
    void (account
      ? sendMagicLink({ kind: 'login', to: account.email, accountId: account.id, returnTo })
      : sendSignupLink(normalized, returnTo, ip)
    ).catch((err) => req.log.error({ err }, 'sending magic link failed'))

    return { data: { message: "If this email is registered, you'll receive a login link." } }
  })

  app.get<{ Querystring: { token?: string } }>('/auth/verify', async (req, reply) => {
    const token = req.query.token
    if (!token) return reply.redirect(`${WEB_URL}/login?error=invalid`)

    const now = new Date()
    type Claimed = { sessionToken: string; returnTo: string | null }
    const claimed: Claimed | null = await db.transaction(async (tx) => {
      // Claim the token in one statement so two concurrent clicks can't both use it.
      const [t] = await tx
        .update(magicLinkTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(magicLinkTokens.tokenHash, sha256(token)),
            isNull(magicLinkTokens.usedAt),
            gt(magicLinkTokens.expiresAt, now),
            // email_change links are confirmed through POST /accounts/me/email/confirm, never by a GET
            inArray(magicLinkTokens.kind, ['login', 'signup']),
          ),
        )
        .returning({
          accountId: magicLinkTokens.accountId,
          email: magicLinkTokens.email,
          returnTo: magicLinkTokens.returnTo,
        })
      if (!t) return null

      let accountId: string
      if (t.accountId) {
        // A login link is only good for the address it was sent to.
        const [a] = await tx.select({ email: accounts.email }).from(accounts).where(eq(accounts.id, t.accountId)).limit(1)
        if (!a || a.email.toLowerCase() !== t.email.toLowerCase()) return null
        accountId = t.accountId
      } else {
        accountId = await accountForSignup(tx, t.email)
      }
      const s = generateToken()
      await tx.insert(sessions).values({
        accountId,
        tokenHash: s.hash,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      })
      return { sessionToken: s.token, returnTo: safeReturnTo(t.returnTo) }
    })

    if (!claimed) {
      const [pending] = await db
        .select({ kind: magicLinkTokens.kind })
        .from(magicLinkTokens)
        .where(and(eq(magicLinkTokens.tokenHash, sha256(token)), eq(magicLinkTokens.kind, 'email_change')))
        .limit(1)
      return reply.redirect(`${WEB_URL}/login?error=${pending ? 'invalid' : 'expired'}`)
    }
    const { sessionToken, returnTo } = claimed

    reply.setCookie(SESSION_COOKIE, sessionToken, {
      ...cookieOptions,
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    })
    return reply.redirect(`${WEB_URL}${returnTo ?? '/dashboard'}`)
  })

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE]
    if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)))
    reply.clearCookie(SESSION_COOKIE, cookieOptions)
    return { data: { ok: true } }
  })

  app.get('/auth/me', async (req) => {
    await authenticate(req)
    const a = req.account
    if (!a || !req.authMethod) throw unauthorized()
    return { data: await accountMe(a, req.authMethod) }
  })
}
