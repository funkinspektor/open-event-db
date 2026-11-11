import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomInt } from 'node:crypto'
import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { magicLinkRequestSchema, safeReturnTo, type AccountMe } from '@open-event-db/shared'
import { generateToken, accounts, magicLinkTokens, organizerMembers, organizers, sessions, sha256 } from '@open-event-db/db'
import { db } from '../db.js'
import { email, type MagicLinkKind } from '../email.js'
import { unauthorized } from '../errors.js'
import { SESSION_COOKIE, SESSION_TTL_MS, authenticate } from '../auth.js'

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000'
const API_PUBLIC_URL = process.env.API_PUBLIC_URL ?? 'http://localhost:3001'
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000
const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000
const SIGNUP_CAP_WINDOW_MS = 24 * 60 * 60 * 1000
const SIGNUP_MAILS_PER_IP_PER_DAY = Number(process.env.SIGNUP_MAILS_PER_IP_PER_DAY) || 10

// In production web and API run on sibling subdomains (kellerkompass.de / api.kellerkompass.de), so the
// cookie needs COOKIE_DOMAIN=kellerkompass.de for the web server to see it. Locally host-only is fine.
const cookieOptions = {
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
}

/** Stores the token and returns a function that mails the link; callers may defer the sending. */
export async function issueMagicLink(input: SendMagicLinkInput): Promise<() => Promise<void>> {
  const { token, hash } = generateToken()
  const ttl = input.kind === 'email_change' ? EMAIL_CHANGE_TTL_MS : MAGIC_LINK_TTL_MS
  await db.insert(magicLinkTokens).values({
    accountId: input.accountId,
    email: input.to,
    kind: input.kind,
    returnTo: input.returnTo ?? null,
    newEmail: input.newEmail ?? null,
    requestIp: input.requestIp ?? null,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + ttl),
  })
  const url = `${API_PUBLIC_URL}/api/v1/auth/verify?token=${encodeURIComponent(token)}`
  return () => email.transport.sendMagicLink({ to: input.to, url, kind: input.kind })
}

export async function sendMagicLink(input: SendMagicLinkInput): Promise<void> {
  await (await issueMagicLink(input))()
}

async function signupCapReached(ip: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(magicLinkTokens)
    .where(
      and(
        eq(magicLinkTokens.kind, 'signup'),
        eq(magicLinkTokens.requestIp, ip),
        gt(magicLinkTokens.createdAt, new Date(Date.now() - SIGNUP_CAP_WINDOW_MS)),
      ),
    )
  return (row?.n ?? 0) >= SIGNUP_MAILS_PER_IP_PER_DAY
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

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/magic-link', { config: { rateLimit: magicLinkRateLimit } }, async (req) => {
    const { email: address, return_to } = magicLinkRequestSchema.parse(req.body)
    const normalized = address.toLowerCase()
    const returnTo = safeReturnTo(return_to)
    const ip = req.ip

    const [account] = await db
      .select()
      .from(accounts)
      .where(sql`lower(${accounts.email}) = ${normalized}`)
      .limit(1)

    // Both branches do the same work in the foreground (one count, one insert); only the mail itself is
    // sent in the background. If the response waited for the send, its timing would reveal whether the
    // email is registered. The token is stored before responding so the per-IP cap sees every request.
    let deliver: (() => Promise<void>) | null = null
    try {
      const capReached = await signupCapReached(ip)
      if (account) {
        deliver = await issueMagicLink({ kind: 'login', to: account.email, accountId: account.id, returnTo })
      } else if (!capReached) {
        deliver = await issueMagicLink({ kind: 'signup', to: normalized, accountId: null, returnTo, requestIp: ip })
      }
    } catch (err) {
      req.log.error({ err }, 'issuing magic link failed')
    }
    if (deliver) void deliver().catch((err) => req.log.error({ err }, 'sending magic link failed'))

    return { data: { message: "If this email is registered, you'll receive a login link." } }
  })

  app.get<{ Querystring: { token?: string } }>('/auth/verify', async (req, reply) => {
    const token = req.query.token
    if (!token) return reply.redirect(`${WEB_URL}/login?error=invalid`)

    const now = new Date()
    const claimed = await db.transaction(async (tx) => {
      // Claim the token in one statement so two concurrent clicks can't both use it.
      const [t] = await tx
        .update(magicLinkTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(magicLinkTokens.tokenHash, sha256(token)),
            isNull(magicLinkTokens.usedAt),
            gt(magicLinkTokens.expiresAt, now),
            // email_change links are consumed by their own handler
            inArray(magicLinkTokens.kind, ['login', 'signup']),
          ),
        )
        .returning({
          accountId: magicLinkTokens.accountId,
          kind: magicLinkTokens.kind,
          email: magicLinkTokens.email,
          returnTo: magicLinkTokens.returnTo,
        })
      if (!t) return null

      const accountId = t.accountId ?? (await accountForSignup(tx, t.email))
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
    // All memberships, verified or not: the settings page lists both
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
    const data: AccountMe = {
      id: a.id,
      email: a.email,
      handle: a.handle,
      display_name: a.displayName,
      is_scout: a.isScout,
      has_api_key: a.apiKeyHash !== null,
      auth_method: req.authMethod,
      onboarded: a.onboardedAt !== null,
      has_calendar: a.calendarToken !== null,
      organizers: memberships,
    }
    return { data }
  })
}
