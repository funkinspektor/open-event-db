import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { magicLinkRequestSchema } from '@open-event-db/shared'
import { generateToken, magicLinkTokens, publishers, sessions, sha256 } from '@open-event-db/db'
import { db } from '../db.js'
import { email } from '../email.js'
import { unauthorized } from '../errors.js'
import { SESSION_COOKIE, SESSION_TTL_MS, authenticate } from '../auth.js'

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000'
const API_PUBLIC_URL = process.env.API_PUBLIC_URL ?? 'http://localhost:3001'
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000

const cookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
}

const magicLinkRateLimit = {
  max: 3,
  timeWindow: '1 hour',
  keyGenerator: (req: FastifyRequest) => {
    const body = req.body as { email?: unknown } | undefined
    return typeof body?.email === 'string' ? `magic:${body.email.trim().toLowerCase()}` : req.ip
  },
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/magic-link', { config: { rateLimit: magicLinkRateLimit } }, async (req) => {
    const { email: address } = magicLinkRequestSchema.parse(req.body)
    const normalized = address.toLowerCase()

    const [publisher] = await db
      .select()
      .from(publishers)
      .where(sql`lower(${publishers.email}) = ${normalized}`)
      .limit(1)

    if (publisher?.verified) {
      const { token, hash } = generateToken()
      await db.insert(magicLinkTokens).values({
        publisherId: publisher.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      })
      const url = `${API_PUBLIC_URL}/api/v1/auth/verify?token=${encodeURIComponent(token)}`
      await email.transport.sendMagicLink({ to: publisher.email, url })
    }

    return { data: { message: "If this email is registered, you'll receive a login link." } }
  })

  app.get<{ Querystring: { token?: string } }>('/auth/verify', async (req, reply) => {
    const token = req.query.token
    if (!token) return reply.redirect(`${WEB_URL}/login?error=invalid`)

    const now = new Date()
    const sessionToken = await db.transaction(async (tx) => {
      const [t] = await tx
        .select()
        .from(magicLinkTokens)
        .where(
          and(
            eq(magicLinkTokens.tokenHash, sha256(token)),
            isNull(magicLinkTokens.usedAt),
            gt(magicLinkTokens.expiresAt, now),
          ),
        )
        .limit(1)
      if (!t) return null

      await tx.update(magicLinkTokens).set({ usedAt: now }).where(eq(magicLinkTokens.id, t.id))

      const s = generateToken()
      await tx.insert(sessions).values({
        publisherId: t.publisherId,
        tokenHash: s.hash,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      })
      return s.token
    })

    if (!sessionToken) return reply.redirect(`${WEB_URL}/login?error=expired`)

    reply.setCookie(SESSION_COOKIE, sessionToken, {
      ...cookieOptions,
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    })
    return reply.redirect(`${WEB_URL}/dashboard`)
  })

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE]
    if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)))
    reply.clearCookie(SESSION_COOKIE, cookieOptions)
    return { data: { ok: true } }
  })

  app.get('/auth/me', async (req) => {
    await authenticate(req)
    const p = req.publisher
    if (!p || !req.authMethod) throw unauthorized()
    return {
      data: {
        id: p.id,
        name: p.name,
        slug: p.slug,
        links: p.links,
        verified: p.verified,
        created_at: p.createdAt.toISOString(),
        email: p.email,
        has_api_key: p.apiKeyHash !== null,
        auth_method: req.authMethod,
      },
    }
  })
}
