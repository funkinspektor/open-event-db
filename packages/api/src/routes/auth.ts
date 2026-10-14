import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { magicLinkRequestSchema } from '@open-event-db/shared'
import { generateToken, magicLinkTokens, publishers, sessions, sha256, type Publisher } from '@open-event-db/db'
import { db } from '../db.js'
import { email } from '../email.js'
import { unauthorized } from '../errors.js'
import { SESSION_COOKIE, SESSION_TTL_MS, authenticate } from '../auth.js'

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000'
const API_PUBLIC_URL = process.env.API_PUBLIC_URL ?? 'http://localhost:3001'
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000

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

async function sendMagicLink(publisher: Publisher): Promise<void> {
  const { token, hash } = generateToken()
  await db.insert(magicLinkTokens).values({
    publisherId: publisher.id,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
  })
  const url = `${API_PUBLIC_URL}/api/v1/auth/verify?token=${encodeURIComponent(token)}`
  await email.transport.sendMagicLink({ to: publisher.email, url })
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
      // Issue and send in the background: if the response waited for this, its timing
      // would reveal whether the email is registered.
      void sendMagicLink(publisher).catch((err) => req.log.error({ err }, 'sending magic link failed'))
    }

    return { data: { message: "If this email is registered, you'll receive a login link." } }
  })

  app.get<{ Querystring: { token?: string } }>('/auth/verify', async (req, reply) => {
    const token = req.query.token
    if (!token) return reply.redirect(`${WEB_URL}/login?error=invalid`)

    const now = new Date()
    const sessionToken = await db.transaction(async (tx) => {
      // Claim the token in one statement so two concurrent clicks can't both use it.
      const [t] = await tx
        .update(magicLinkTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(magicLinkTokens.tokenHash, sha256(token)),
            isNull(magicLinkTokens.usedAt),
            gt(magicLinkTokens.expiresAt, now),
          ),
        )
        .returning({ publisherId: magicLinkTokens.publisherId })
      if (!t) return null

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
        is_publisher: p.isPublisher,
        is_scout: p.isScout,
        created_at: p.createdAt.toISOString(),
        email: p.email,
        has_api_key: p.apiKeyHash !== null,
        auth_method: req.authMethod,
      },
    }
  })
}
