import type { FastifyInstance } from 'fastify'
import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  accountUpdateSchema,
  checkHandleQuerySchema,
  deleteAccountSchema,
  emailChangeSchema,
  onboardingSchema,
} from '@open-event-db/shared'
import {
  accounts,
  deleteAccount,
  generateApiKey,
  generateToken,
  magicLinkTokens,
  soleMemberships,
  type Account,
} from '@open-event-db/db'
import { db } from '../db.js'
import { ApiError, badRequest } from '../errors.js'
import { accountMe, API_PUBLIC_URL, cookieOptions, sendMagicLink } from './auth.js'
import { SESSION_COOKIE, currentAccount, requireAuth, requireSession, writeRateLimit } from '../auth.js'
import { diff, logEdit } from '../history.js'

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null
  return e?.code === '23505' || e?.cause?.code === '23505'
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
    return { data: { available: !row } }
  })

  app.put('/accounts/me', write, async (req) => {
    const me = currentAccount(req)
    const body = accountUpdateSchema.parse(req.body)

    const patch: Partial<typeof accounts.$inferInsert> = {}
    if (body.display_name !== undefined) patch.displayName = body.display_name
    if (body.handle !== undefined && body.handle !== me.handle) {
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

  app.post('/accounts/me/email', sessionWrite, async (req) => {
    const me = currentAccount(req)
    const { email: raw } = emailChangeSchema.parse(req.body)
    const address = raw.toLowerCase()
    if (address === me.email.toLowerCase()) {
      throw badRequest('This is already your email address', 'same_email')
    }
    // Only the newest link counts
    await db
      .delete(magicLinkTokens)
      .where(and(eq(magicLinkTokens.accountId, me.id), eq(magicLinkTokens.kind, 'email_change'), isNull(magicLinkTokens.usedAt)))
    // Sent whether or not the address is taken: the click shows that, so this response reveals nothing.
    await sendMagicLink({ kind: 'email_change', to: address, accountId: me.id, newEmail: address })
    return { data: { sent: true } }
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
