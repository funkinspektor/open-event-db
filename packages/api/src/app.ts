import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { errorHandler } from './error-handler.js'
import { healthRoutes } from './routes/health.js'
import { tagsRoutes } from './routes/tags.js'
import { publisherRoutes } from './routes/publishers.js'
import { venueRoutes } from './routes/venues.js'
import { eventRoutes } from './routes/events.js'
import { authRoutes } from './routes/auth.js'

export interface AppOptions {
  logger?: boolean
}

export async function buildApp({ logger = true }: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger })

  app.setErrorHandler(errorHandler)
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
  })

  await app.register(healthRoutes)
  await app.register(
    async (api) => {
      await api.register(eventRoutes)
      await api.register(venueRoutes)
      await api.register(publisherRoutes)
      await api.register(tagsRoutes)
      await api.register(authRoutes)
    },
    { prefix: '/api/v1' },
  )

  return app
}
