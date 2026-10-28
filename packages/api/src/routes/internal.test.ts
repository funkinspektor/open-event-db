import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { ingestRunner } from '../ingest/run.js'
import { buildApp } from '../app.js'

let app: FastifyInstance
const original = process.env.INGEST_CRON_SECRET
const RESULT = { skipped: false, sources: [{ slug: 'stub', ok: true, seen: 0, created: 0, updated: 0, synced: 0, gone: 0 }] }
let runs = 0

beforeAll(async () => {
  app = await buildApp({ logger: false })
})

afterEach(() => {
  if (original === undefined) delete process.env.INGEST_CRON_SECRET
  else process.env.INGEST_CRON_SECRET = original
  ingestRunner.reset()
  runs = 0
})

afterAll(async () => {
  await app.close()
})

// The stub keeps the real pipeline (and its global advisory lock) out of the route tests
const stubRunner = () =>
  ingestRunner.setRunner(async () => {
    runs++
    return RESULT
  })

const post = (headers: Record<string, string> = {}, payload?: string | object) =>
  app.inject({ method: 'POST', url: '/internal/ingest/run', headers, payload })

describe('POST /internal/ingest/run', () => {
  it('is 404 when INGEST_CRON_SECRET is not set, even with a header', async () => {
    delete process.env.INGEST_CRON_SECRET
    stubRunner()
    expect((await post()).statusCode).toBe(404)
    expect((await post({ 'x-ingest-secret': '' })).statusCode).toBe(404)
    expect((await post({ 'x-ingest-secret': 'anything' })).statusCode).toBe(404)
    expect(runs).toBe(0)
  })

  it('is 404 when INGEST_CRON_SECRET is empty', async () => {
    process.env.INGEST_CRON_SECRET = ''
    stubRunner()
    expect((await post({ 'x-ingest-secret': '' })).statusCode).toBe(404)
    expect(runs).toBe(0)
  })

  it('is 403 for a missing or wrong secret', async () => {
    process.env.INGEST_CRON_SECRET = 'right-secret'
    stubRunner()
    const missing = await post()
    expect(missing.statusCode).toBe(403)
    expect(missing.json().error.code).toBe('forbidden')
    expect((await post({ 'x-ingest-secret': 'wrong-secret' })).statusCode).toBe(403)
    expect((await post({ 'x-ingest-secret': 'right-secret-and-more' })).statusCode).toBe(403)
    expect(runs).toBe(0)
  })

  it('runs the pipeline and returns its result for the right secret', async () => {
    process.env.INGEST_CRON_SECRET = 'right-secret'
    stubRunner()
    const res = await post({ 'x-ingest-secret': 'right-secret' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: RESULT })
    expect(runs).toBe(1)
  })

  // Scaleway cron triggers cannot set headers; they POST their `args` as the JSON body
  it('accepts the secret from the JSON body', async () => {
    process.env.INGEST_CRON_SECRET = 'right-secret'
    stubRunner()
    const res = await post({}, { secret: 'right-secret' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: RESULT })
    expect(runs).toBe(1)
  })

  it('is 403 for a wrong or malformed body secret', async () => {
    process.env.INGEST_CRON_SECRET = 'right-secret'
    stubRunner()
    expect((await post({}, { secret: 'wrong-secret' })).statusCode).toBe(403)
    expect((await post({}, { secret: ['right-secret'] })).statusCode).toBe(403)
    expect((await post({}, { other: 'right-secret' })).statusCode).toBe(403)
    expect(runs).toBe(0)
  })

  it('accepts the header with an empty JSON body', async () => {
    process.env.INGEST_CRON_SECRET = 'right-secret'
    stubRunner()
    const json = await post({ 'x-ingest-secret': 'right-secret', 'content-type': 'application/json' }, '')
    expect(json.statusCode).toBe(200)
    const blank = await post({ 'x-ingest-secret': 'right-secret', 'content-type': 'application/json' }, '  ')
    expect(blank.statusCode).toBe(200)
    expect(runs).toBe(2)
    // Without the secret an empty body is still a 403, not a parse error
    expect((await post({ 'content-type': 'application/json' }, '')).statusCode).toBe(403)
  })

  it('is not subject to the global rate limit', async () => {
    process.env.INGEST_CRON_SECRET = 'right-secret'
    stubRunner()
    for (let i = 0; i < 105; i++) {
      expect((await post({ 'x-ingest-secret': 'right-secret' })).statusCode).toBe(200)
    }
  })

  it('is not subject to the global rate limit with the secret in the body', async () => {
    process.env.INGEST_CRON_SECRET = 'right-secret'
    stubRunner()
    for (let i = 0; i < 105; i++) {
      expect((await post({}, { secret: 'right-secret' })).statusCode).toBe(200)
    }
  })
})
