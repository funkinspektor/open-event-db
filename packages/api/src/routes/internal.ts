import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { forbidden, notFound } from '../errors.js'
import { ingestRunner } from '../ingest/run.js'

const sha256 = (value: string) => createHash('sha256').update(value).digest()

/** Constant-time comparison of fixed-length digests: keeps timingSafeEqual happy and hides the secret's length. */
function matchesSecret(candidate: unknown, secret: string): boolean {
  return typeof candidate === 'string' && timingSafeEqual(sha256(candidate), sha256(secret))
}

/**
 * True when the request carries the cron secret, in the `X-Ingest-Secret` header or as `secret` in the
 * JSON body (Scaleway cron triggers can't set headers; they POST their configured args as the body).
 * The secret is read from the environment per request.
 */
export function hasIngestSecret(req: Pick<FastifyRequest, 'headers' | 'body'>): boolean {
  const secret = process.env.INGEST_CRON_SECRET
  if (!secret) return false
  const body = req.body
  const bodySecret = typeof body === 'object' && body !== null ? (body as { secret?: unknown }).secret : undefined
  return matchesSecret(req.headers['x-ingest-secret'], secret) || matchesSecret(bodySecret, secret)
}

export async function internalRoutes(app: FastifyInstance) {
  // A header-only call may still send `Content-Type: application/json` with an empty body; Fastify's
  // parser would answer 400 before the secret is checked. Scoped to this plugin.
  const parseJson = app.getDefaultJsonParser('error', 'error')
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const text = body.toString()
    if (text.trim() === '') return done(null, undefined)
    parseJson(req, text, done)
  })

  // Called once a day by a Scaleway cron trigger; no secret configured means the endpoint doesn't exist
  const run = async (req: FastifyRequest) => {
    if (!process.env.INGEST_CRON_SECRET) throw notFound()
    if (!hasIngestSecret(req)) throw forbidden()
    return { data: await ingestRunner.run() }
  }
  app.post('/internal/ingest/run', run)
  // Scaleway container cron triggers always POST to the root path
  app.post('/', run)
}
