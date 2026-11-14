import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { ipKey } from './ip-key.js'
import { errorHandler } from './error-handler.js'
import { notFound } from './errors.js'
import { healthRoutes } from './routes/health.js'
import { calendarRoutes } from './routes/calendar.js'
import { tagsRoutes } from './routes/tags.js'
import { organizerRoutes } from './routes/organizers.js'
import { accountRoutes } from './routes/accounts.js'
import { venueRoutes } from './routes/venues.js'
import { eventRoutes } from './routes/events.js'
import { interestRoutes } from './routes/interests.js'
import { authRoutes } from './routes/auth.js'
import { extractRoutes } from './routes/extract.js'
import { suggestionRoutes } from './routes/suggestions.js'
import { ingestRoutes } from './routes/ingest.js'
import { IMAGE_CACHE_CONTROL, imageStore, isLocalStore } from './images/store.js'

const UUID_PARAMS = ['id', 'organizer_id'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AppOptions {
  logger?: boolean
  /** Where log lines go (tests capture them); default stdout. */
  logStream?: { write(line: string): void }
}

// Behind a load balancer every request arrives from the proxy, so per-IP rate limits would be shared by
// everyone. TRUST_PROXY takes the client address from X-Forwarded-For instead:
//  - `true` trusts every hop, so the client picks its own address whenever the proxy appends to the header
//  - an integer is a hop count
//  - anything else is a comma-separated trust list (IPs, CIDRs, `loopback`, `linklocal`, `uniquelocal`):
//    internal hops are skipped and the right-most untrusted address is the client
export function trustProxy(value = process.env.TRUST_PROXY): boolean | number | string {
  const v = value?.trim()
  if (!v || v === 'false') return false
  if (v === 'true') return true
  const hops = Number(v)
  if (Number.isInteger(hops)) return hops > 0 ? hops : false
  return v
}

/**
 * The request as the logger records it. The default serializer logs the URL, which would put the calendar
 * subscription token (a long-lived credential, polled hourly) and login tokens into the logs.
 */
export function redactUrl(url: string): string {
  return url
    .replace(/(\/cal\/)[^/?#]+(\.ics)/, '$1[redacted]$2')
    .replace(/([?&]token=)[^&#]*/g, '$1[redacted]')
}

export function serializeReq(req: FastifyRequest) {
  return {
    method: req.method,
    url: redactUrl(req.url),
    version: req.headers?.['accept-version'] as string | undefined,
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  }
}

// The web server renders pages for all visitors from a single IP. It sends this shared secret and is
// exempt from the global per-IP limit (per-route write limits still apply).
const INTERNAL_TOKEN = process.env.API_INTERNAL_TOKEN

export async function buildApp({ logger = true, logStream }: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ? { serializers: { req: serializeReq }, ...(logStream ? { stream: logStream } : {}) } : false,
    trustProxy: trustProxy(),
  })

  app.setErrorHandler(errorHandler)
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: `Route ${req.method} ${req.url} not found` } })
  })
  app.decorateRequest('account', null)
  app.decorateRequest('authMethod', null)

  await app.register(cookie)

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? true,
    credentials: true,
  })

  // preHandler phase so per-route write limits can key on the authenticated account
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    hook: 'preHandler',
    // IPv6 clients get a whole /64, so bucket by prefix
    keyGenerator: (req) => ipKey(req.ip),
    allowList: (req) => !!INTERNAL_TOKEN && req.headers['x-internal-token'] === INTERNAL_TOKEN,
  })

  await app.register(healthRoutes)
  // Development without a bucket: the local image store's files. In production the bucket serves them.
  app.get<{ Params: { '*': string } }>('/images/*', async (req, reply) => {
    const store = imageStore.store
    const found = isLocalStore(store) ? await store.read(req.params['*']) : null
    if (!found) throw notFound('Image not found')
    return reply.type(found.type).header('cache-control', IMAGE_CACHE_CONTROL).send(found.data)
  })
  await app.register(calendarRoutes)
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
      await api.register(ingestRoutes)
      await api.register(venueRoutes)
      await api.register(organizerRoutes)
      await api.register(accountRoutes)
      await api.register(tagsRoutes)
      await api.register(authRoutes)
      await api.register(interestRoutes)
      await api.register(suggestionRoutes)
    },
    { prefix: '/api/v1' },
  )

  return app
}
