import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { errorHandler } from './error-handler.js'
import { healthRoutes } from './routes/health.js'
import { tagsRoutes } from './routes/tags.js'
import { publisherRoutes } from './routes/publishers.js'
import { venueRoutes } from './routes/venues.js'
import { eventRoutes } from './routes/events.js'

export interface AppOptions {
  logger?: boolean
}

export async function buildApp({ logger = true }: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger })

  app.setErrorHandler(errorHandler)

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? true,
    credentials: true,
  })

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })

  await app.register(healthRoutes)
  await app.register(
    async (api) => {
      await api.register(eventRoutes)
      await api.register(venueRoutes)
      await api.register(publisherRoutes)
      await api.register(tagsRoutes)
    },
    { prefix: '/api/v1' },
  )

  return app
}
