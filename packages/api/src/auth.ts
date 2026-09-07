import type { FastifyReply, FastifyRequest } from 'fastify'
import { and, eq, gt } from 'drizzle-orm'
import { API_KEY_PREFIX, publishers, sessions, sha256, type Publisher } from '@open-event-db/db'
import { db } from './db.js'
import { forbidden, unauthorized } from './errors.js'

export const SESSION_COOKIE = 'oedb_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type AuthMethod = 'api_key' | 'session'

declare module 'fastify' {
  interface FastifyRequest {
    publisher: Publisher | null
    authMethod: AuthMethod | null
  }
}

export async function authenticate(req: FastifyRequest): Promise<void> {
  req.publisher = null
  req.authMethod = null

  const header = req.headers.authorization
  if (header) {
    const [scheme, key] = header.split(' ')
    if (scheme !== 'Bearer' || !key?.startsWith(API_KEY_PREFIX)) {
      throw unauthorized('Invalid API key')
    }
    const [p] = await db
      .select()
      .from(publishers)
      .where(eq(publishers.apiKeyHash, sha256(key)))
      .limit(1)
    if (!p) throw unauthorized('Invalid API key')
    req.publisher = p
    req.authMethod = 'api_key'
    return
  }

  const token = req.cookies?.[SESSION_COOKIE]
  if (!token) return

  const now = new Date()
  const [row] = await db
    .select({ session: sessions, publisher: publishers })
    .from(sessions)
    .innerJoin(publishers, eq(publishers.id, sessions.publisherId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)))
    .limit(1)
  if (!row) throw unauthorized('Session expired or invalid')

  if (row.session.expiresAt.getTime() - now.getTime() < SESSION_TTL_MS / 2) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(sessions.id, row.session.id))
  }

  req.publisher = row.publisher
  req.authMethod = 'session'
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  await authenticate(req)
  if (!req.publisher) throw unauthorized()
  if (!req.publisher.verified) throw forbidden('Publisher is not verified')
}

export async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply)
  if (req.authMethod !== 'session') {
    throw forbidden('This endpoint requires a browser session, not an API key')
  }
}

export function currentPublisher(req: FastifyRequest): Publisher {
  if (!req.publisher) throw unauthorized()
  return req.publisher
}

export const writeRateLimit = {
  max: 30,
  timeWindow: '1 minute',
  keyGenerator: (req: FastifyRequest) => req.publisher?.id ?? req.ip,
}
