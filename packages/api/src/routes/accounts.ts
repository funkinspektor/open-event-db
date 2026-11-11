import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import {
  accountUpdateSchema,
  checkHandleQuerySchema,
  deleteAccountSchema,
  emailChangeConfirmSchema,
  emailChangeSchema,
  onboardingSchema,
} from '@open-event-db/shared'
import {
  accounts,
  deleteAccount,
  generateApiKey,
  generateToken,
  magicLinkTokens,
  sha256,
  soleMemberships,
  type Account,
} from '@open-event-db/db'
import { db } from '../db.js'
import { ApiError, badRequest, forbidden } from '../errors.js'
import { email as mail } from '../email.js'
import { accountMe, API_PUBLIC_URL, cookieOptions, sendMagicLink } from './auth.js'
import { SESSION_COOKIE, currentAccount, requireAuth, requireSession, writeRateLimit } from '../auth.js'
import { diff, logEdit } from '../history.js'

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null
  return e?.code === '23505' || e?.cause?.code === '23505'
}

/**
 * Handles an account picks itself must not collide with the ones the system generates: `deleted-<id>` (set on
 * deletion; pre-claiming it would break that account's later deletion) and the provisional `new-xxxxxxxx`.
 */
export const isReservedHandle = (h: string) => h.startsWith('deleted-') || /^new-[a-z0-9]{8}$/.test(h)
const reservedHandle = () => badRequest('This handle is reserved', 'handle_reserved')

// An email-change link goes to a third party and is valid for 24 h, so the endpoint is limited per account
// and per target address. In memory is enough: the API runs as a single instance.
const EMAIL_CHANGE_LIMIT = 3
const EMAIL_CHANGE_WINDOW_MS = 60 * 60 * 1000
const emailChangeHits = new Map<string, number[]>()

function allowEmailChangeTarget(address: string, now = Date.now()): boolean {
  const recent = (emailChangeHits.get(address) ?? []).filter((t) => now - t < EMAIL_CHANGE_WINDOW_MS)
  if (recent.length >= EMAIL_CHANGE_LIMIT) {
    emailChangeHits.set(address, recent)
    return false
  }
  recent.push(now)
  emailChangeHits.set(address, recent)
  if (emailChangeHits.size > 1000) {
    for (const [key, times] of emailChangeHits) {
      if (times.every((t) => now - t >= EMAIL_CHANGE_WINDOW_MS)) emailChangeHits.delete(key)
    }
  }
  return true
}

const emailChangeRateLimit = {
  max: EMAIL_CHANGE_LIMIT,
  timeWindow: '1 hour',
  keyGenerator: (req: FastifyRequest) => `email-change:${req.account?.id ?? req.ip}`,
}

const calendarUrl = (token: string) => `${API_PUBLIC_URL}/cal/${token}.ics`

const sessionWrite = { onRequest: requireSession, config: { rateLimit: writeRateLimit } }
const write = { onRequest: requireAuth, config: { rateLimit: writeRateLimit } }

function serializeAccount(a: Account) {
  return { id: a.id, handle: a.handle, display_name: a.displayName }
}

function accountSnapshot(a: Account): Record<string, unknown> {
  return { handle: a.handle, display_name: a.displayName }
}

export async function accountRoutes(app: FastifyInstance) {
  app.get('/accounts/check-handle', async (req) => {
    const { handle } = checkHandleQuerySchema.parse(req.query)
    const [row] = await db
      .select({ exists: sql<boolean>`true` })
      .from(accounts)
      .where(eq(accounts.handle, handle))
      .limit(1)
    return { data: { available: !row && !isReservedHandle(handle) } }
  })

  app.put('/accounts/me', write, async (req) => {
    const me = currentAccount(req)
    const body = accountUpdateSchema.parse(req.body)

    const patch: Partial<typeof accounts.$inferInsert> = {}
    if (body.display_name !== undefined) patch.displayName = body.display_name
    if (body.handle !== undefined && body.handle !== me.handle) {
      if (isReservedHandle(body.handle)) throw reservedHandle()
      const [taken] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.handle, body.handle))
        .limit(1)
      if (taken) throw badRequest('This handle is already taken', 'handle_taken')
      patch.handle = body.handle
    }
    if (Object.keys(patch).length === 0) return { data: serializeAccount(me) }

    const updated = await db.transaction(async (tx) => {
      const [a] = await tx
        .update(accounts)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(accounts.id, me.id))
        .returning()
      if (!a) throw new Error('update returned no row')
      await logEdit(tx, {
        entityType: 'account',
        entityId: me.id,
        accountId: me.id,
        action: 'updated',
        diff: diff(accountSnapshot(me), accountSnapshot(a)),
      })
      return a
    })

    return { data: serializeAccount(updated) }
  })

  app.post(
    '/accounts/me/api-key',
    { onRequest: requireSession, config: { rateLimit: writeRateLimit } },
    async (req, reply) => {
      const me = currentAccount(req)
      const { key, hash } = generateApiKey()
      await db
        .update(accounts)
        .set({ apiKeyHash: hash, updatedAt: new Date() })
        .where(eq(accounts.id, me.id))
      reply.status(201)
      return { data: { api_key: key } }
    },
  )

  app.post('/accounts/me/onboarding', sessionWrite, async (req) => {
    const me = currentAccount(req)
    if ((req.body as { accept_terms?: unknown } | null)?.accept_terms !== true) {
      throw badRequest('The terms of use must be accepted', 'terms_required')
    }
    const body = onboardingSchema.parse(req.body)
    if (me.onboardedAt) throw new ApiError(409, 'already_onboarded', 'This account is already set up')

    if (body.handle !== me.handle) {
      if (isReservedHandle(body.handle)) throw reservedHandle()
      const [taken] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.handle, body.handle)).limit(1)
      if (taken) throw badRequest('This handle is already taken', 'handle_taken')
    }
    const now = new Date()
    const updated = await db
      .transaction(async (tx) => {
        // Only while still pending, so a double submit cannot overwrite a finished onboarding.
        const [a] = await tx
          .update(accounts)
          .set({ displayName: body.display_name, handle: body.handle, onboardedAt: now, termsAcceptedAt: now, updatedAt: now })
          .where(and(eq(accounts.id, me.id), isNull(accounts.onboardedAt)))
          .returning()
        if (!a) throw new ApiError(409, 'already_onboarded', 'This account is already set up')
        await logEdit(tx, {
          entityType: 'account',
          entityId: me.id,
          accountId: me.id,
          action: 'updated',
          diff: { ...diff(accountSnapshot(me), accountSnapshot(a)), via: 'onboarding' },
        })
        return a
      })
      .catch((err) => {
        if (isUniqueViolation(err)) throw badRequest('This handle is already taken', 'handle_taken')
        throw err
      })
    return { data: await accountMe({ ...me, ...updated }, 'session') }
  })

  app.post(
    '/accounts/me/email',
    { onRequest: requireSession, config: { rateLimit: emailChangeRateLimit } },
    async (req) => {
      const me = currentAccount(req)
      const { email: raw } = emailChangeSchema.parse(req.body)
      const address = raw.toLowerCase()
      if (address === me.email.toLowerCase()) {
        throw badRequest('This is already your email address', 'same_email')
      }
      if (!allowEmailChangeTarget(address)) {
        throw new ApiError(429, 'rate_limited', 'Rate limit exceeded, retry later')
      }
      // Only the newest link counts
      await db
        .delete(magicLinkTokens)
        .where(
          and(eq(magicLinkTokens.accountId, me.id), eq(magicLinkTokens.kind, 'email_change'), isNull(magicLinkTokens.usedAt)),
        )
      // Sent whether or not the address is taken (the confirmation shows that), so this response reveals
      // nothing. In the background, so a transport error cannot fail the request after the old links are gone.
      void sendMagicLink({
        kind: 'email_change',
        to: address,
        accountId: me.id,
        newEmail: address,
        requesterHandle: me.handle,
      }).catch((err) => req.log.error({ err }, 'sending email-change link failed'))
      return { data: { sent: true } }
    },
  )

  // Confirmation is a POST from the logged-in account that asked for the change: opening the mailed link
  // (a mail scanner, the address's owner) alone binds nothing.
  app.post('/accounts/me/email/confirm', sessionWrite, async (req) => {
    const me = currentAccount(req)
    const { token } = emailChangeConfirmSchema.parse(req.body)
    const hash = sha256(token)
    const now = new Date()

    const [pending] = await db
      .select({ accountId: magicLinkTokens.accountId })
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.tokenHash, hash),
          eq(magicLinkTokens.kind, 'email_change'),
          isNull(magicLinkTokens.usedAt),
          gt(magicLinkTokens.expiresAt, now),
        ),
      )
      .limit(1)
    if (!pending) throw badRequest('This link is invalid or has expired', 'invalid_token')
    // Checked before claiming, so the right account can still use the link
    if (pending.accountId !== me.id) throw forbidden('This link belongs to another account', 'wrong_account')

    const outcome = await db.transaction(async (tx) => {
      // Claim in one statement so two concurrent confirmations can't both apply it.
      const [t] = await tx
        .update(magicLinkTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(magicLinkTokens.tokenHash, hash),
            eq(magicLinkTokens.kind, 'email_change'),
            eq(magicLinkTokens.accountId, me.id),
            isNull(magicLinkTokens.usedAt),
            gt(magicLinkTokens.expiresAt, now),
          ),
        )
        .returning({ newEmail: magicLinkTokens.newEmail })
      if (!t?.newEmail) throw badRequest('This link is invalid or has expired', 'invalid_token')
      const newEmail = t.newEmail.toLowerCase()

      const [account] = await tx.select({ email: accounts.email }).from(accounts).where(eq(accounts.id, me.id)).limit(1)
      if (!account) throw badRequest('This link is invalid or has expired', 'invalid_token')
      const oldEmail = account.email
      if (oldEmail.toLowerCase() === newEmail) return { result: 'changed' as const, oldEmail, newEmail }

      const [taken] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(sql`lower(${accounts.email}) = ${newEmail}`)
        .limit(1)
      if (taken) return { result: 'taken' as const, oldEmail, newEmail }
      try {
        // A savepoint: losing a race on the unique email must not abort the surrounding transaction.
        await tx.transaction((sp) =>
          sp.update(accounts).set({ email: newEmail, updatedAt: now }).where(eq(accounts.id, me.id)),
        )
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
        return { result: 'taken' as const, oldEmail, newEmail }
      }
      // Links sent to the old address must not outlive it; other pending changes are void too.
      await tx
        .delete(magicLinkTokens)
        .where(
          and(
            eq(magicLinkTokens.accountId, me.id),
            isNull(magicLinkTokens.usedAt),
            sql`${magicLinkTokens.kind} in ('login', 'email_change')`,
          ),
        )
      return { result: 'changed' as const, oldEmail, newEmail }
    })

    if (outcome.result === 'changed' && outcome.oldEmail.toLowerCase() !== outcome.newEmail) {
      await mail.transport
        .sendEmailChangedNotice({ to: outcome.oldEmail, newEmail: outcome.newEmail })
        .catch((err) => req.log.error({ err }, 'sending email-change notice failed'))
    }
    return { data: { result: outcome.result } }
  })

  app.get('/accounts/me/delete-preview', { onRequest: requireSession }, async (req) => {
    const me = currentAccount(req)
    return { data: { orphaned_organizers: await soleMemberships(db, me.id) } }
  })

  app.delete('/accounts/me', sessionWrite, async (req, reply) => {
    const me = currentAccount(req)
    const { confirm_handle } = deleteAccountSchema.parse(req.body)
    if (confirm_handle !== me.handle) {
      throw badRequest('The handle does not match', 'confirm_mismatch')
    }
    await deleteAccount(db, me.id, { via: 'self' })
    reply.clearCookie(SESSION_COOKIE, cookieOptions)
    return { data: { ok: true } }
  })

  app.post('/accounts/me/calendar-token', sessionWrite, async (req) => {
    const me = currentAccount(req)
    const { token } = generateToken()
    await db.update(accounts).set({ calendarToken: token, updatedAt: new Date() }).where(eq(accounts.id, me.id))
    return { data: { url: calendarUrl(token) } }
  })

  app.get('/accounts/me/calendar', { onRequest: requireSession }, async (req) => {
    const me = currentAccount(req)
    return { data: { url: me.calendarToken ? calendarUrl(me.calendarToken) : null } }
  })
}
