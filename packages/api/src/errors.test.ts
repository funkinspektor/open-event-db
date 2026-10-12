import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'

// None of these requests reach Postgres: they fail in routing, body parsing or param checks.
let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp({ logger: false })
})

afterAll(async () => {
  await app.close()
})

describe('error envelope', () => {
  it('answers unknown routes with the standard 404 envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({
      error: { code: 'not_found', message: 'Route GET /api/v1/nope not found' },
    })
  })

  it.each(['/api/v1/events/not-a-uuid', '/api/v1/venues/123'])(
    'answers a malformed ID in %s with 404 instead of 500',
    async (url) => {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('not_found')
    },
  )

  it('still requires auth before checking IDs on write routes', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/events/not-a-uuid', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('answers malformed JSON with 400 instead of 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      headers: { 'content-type': 'application/json' },
      payload: '{"email": ',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('bad_request')
  })
})
