import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { forbidden, notFound } from '../errors.js'
import { ingestRunner } from '../ingest/run.js'

const sha256 = (value: string) => createHash('sha256').update(value).digest()

/**
 * True when the request carries the cron secret. Read from the environment per request. Comparing
 * fixed-length digests keeps timingSafeEqual happy and hides the secret's length.
 */
export function hasIngestSecret(header: string | string[] | undefined): boolean {
  const secret = process.env.INGEST_CRON_SECRET
  if (!secret || typeof header !== 'string') return false
  return timingSafeEqual(sha256(header), sha256(secret))
}

export async function internalRoutes(app: FastifyInstance) {
  // Called once a day by a Scaleway cron trigger; no secret configured means the endpoint doesn't exist
  app.post('/internal/ingest/run', async (req) => {
    if (!process.env.INGEST_CRON_SECRET) throw notFound()
    if (!hasIngestSecret(req.headers['x-ingest-secret'])) throw forbidden()
    return { data: await ingestRunner.run() }
  })
}
