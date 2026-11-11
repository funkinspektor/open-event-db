import type { FastifyReply, FastifyRequest } from 'fastify'
import { and, eq, gt } from 'drizzle-orm'
import type { PermissionActor } from '@open-event-db/shared'
import {
  API_KEY_PREFIX,
  accounts,
  organizerMembers,
  organizers,
  sessions,
  sha256,
  type Account,
} from '@open-event-db/db'
import { db } from './db.js'
import { forbidden, unauthorized } from './errors.js'

export const SESSION_COOKIE = 'oedb_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** The account plus the ids of the verified organizers it belongs to. */
export type AuthAccount = Account & { organizerIds: string[] }

export type AuthMethod = 'api_key' | 'session'

declare module 'fastify' {
  interface FastifyRequest {
    account: AuthAccount | null
    authMethod: AuthMethod | null
  }
}

async function withOrganizers(account: Account): Promise<AuthAccount> {
  const rows = await db
    .select({ id: organizerMembers.organizerId })
    .from(organizerMembers)
    .innerJoin(organizers, eq(organizers.id, organizerMembers.organizerId))
    .where(and(eq(organizerMembers.accountId, account.id), eq(organizers.verified, true)))
  return { ...account, organizerIds: rows.map((r) => r.id) }
}

export async function authenticate(req: FastifyRequest): Promise<void> {
  req.account = null
  req.authMethod = null

  const header = req.headers.authorization
  if (header) {
    const [scheme, key] = header.split(' ')
    if (scheme !== 'Bearer' || !key?.startsWith(API_KEY_PREFIX)) {
      throw unauthorized('Invalid API key')
    }
    const [a] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.apiKeyHash, sha256(key)))
      .limit(1)
    if (!a) throw unauthorized('Invalid API key')
    req.account = await withOrganizers(a)
    req.authMethod = 'api_key'
    return
  }

  const token = req.cookies?.[SESSION_COOKIE]
  if (!token) return

  const now = new Date()
  const [row] = await db
    .select({ session: sessions, account: accounts })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)))
    .limit(1)
  if (!row) throw unauthorized('Session expired or invalid')

  if (row.session.expiresAt.getTime() - now.getTime() < SESSION_TTL_MS / 2) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(sessions.id, row.session.id))
  }

  req.account = await withOrganizers(row.account)
  req.authMethod = 'session'
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  await authenticate(req)
  if (!req.account) throw unauthorized()
}

export async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply)
  if (req.authMethod !== 'session') {
    throw forbidden('This endpoint requires a browser session, not an API key')
  }
}

export function currentAccount(req: FastifyRequest): AuthAccount {
  if (!req.account) throw unauthorized()
  return req.account
}

export function actorOf(a: AuthAccount): PermissionActor {
  return { id: a.id, is_scout: a.isScout, organizer_ids: a.organizerIds }
}

export const writeRateLimit = {
  max: 30,
  timeWindow: '1 minute',
  keyGenerator: (req: FastifyRequest) => req.account?.id ?? req.ip,
}

/** Writing events or venues needs a right: being a scout or a member of a verified organizer. */
export async function requireRights(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply)
  const a = currentAccount(req)
  if (!a.isScout && a.organizerIds.length === 0) {
    throw forbidden('This account has no rights to write events or venues', 'no_rights')
  }
}

/**
 * Runs after requireAuth/requireSession: an account that hasn't finished /welcome (no recorded consent)
 * may only onboard, look at itself, log out or delete itself.
 */
export async function requireOnboarded(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!currentAccount(req).onboardedAt) {
    throw forbidden('Finish onboarding first', 'onboarding_required')
  }
}
