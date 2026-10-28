import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { errorHandler } from './error-handler.js'
import { notFound } from './errors.js'
import { healthRoutes } from './routes/health.js'
import { tagsRoutes } from './routes/tags.js'
import { publisherRoutes } from './routes/publishers.js'
import { venueRoutes } from './routes/venues.js'
import { eventRoutes } from './routes/events.js'
import { authRoutes } from './routes/auth.js'
import { extractRoutes } from './routes/extract.js'
import { hasIngestSecret, internalRoutes } from './routes/internal.js'

const UUID_PARAMS = ['id', 'publisher_id'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AppOptions {
  logger?: boolean
}

// Behind a load balancer every request arrives from the proxy, so per-IP rate limits would be shared by
// everyone. TRUST_PROXY=true (or a hop count) takes the client address from X-Forwarded-For instead.
function trustProxy(): boolean | number {
  const v = process.env.TRUST_PROXY
  if (v === 'true') return true
  const hops = Number(v)
  return Number.isInteger(hops) && hops > 0 ? hops : false
}

// The web server renders pages for all visitors from a single IP. It sends this shared secret and is
// exempt from the global per-IP limit (per-route write limits still apply).
const INTERNAL_TOKEN = process.env.API_INTERNAL_TOKEN

export async function buildApp({ logger = true }: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger, trustProxy: trustProxy() })

  app.setErrorHandler(errorHandler)
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: `Route ${req.method} ${req.url} not found` } })
  })
  app.decorateRequest('publisher', null)
  app.decorateRequest('authMethod', null)

  await app.register(cookie)

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? true,
    credentials: true,
  })

  // preHandler phase so per-route write limits can key on the authenticated publisher
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    hook: 'preHandler',
    // The cron call is exempt too, but only with the right secret, so guessing it stays rate limited
    allowList: (req) =>
      (!!INTERNAL_TOKEN && req.headers['x-internal-token'] === INTERNAL_TOKEN) ||
      hasIngestSecret(req.headers['x-ingest-secret']),
  })

  await app.register(healthRoutes)
  await app.register(internalRoutes)
  await app.register(
    async (api) => {
      // ID path params are UUIDs; anything else can't match a row, so answer 404
      // before Postgres rejects the cast with a 500. Runs after auth (onRequest).
      api.addHook('preValidation', async (req) => {
        const params = req.params as Record<string, string>
        for (const key of UUID_PARAMS) {
          if (key in params && !UUID_RE.test(params[key]!)) throw notFound()
        }
      })
      await api.register(eventRoutes)
      await api.register(extractRoutes)
      await api.register(venueRoutes)
      await api.register(publisherRoutes)
      await api.register(tagsRoutes)
      await api.register(authRoutes)
    },
    { prefix: '/api/v1' },
  )

  return app
}
