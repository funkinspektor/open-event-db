import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { cleanup, createAccount, createOrganizer } from '../test/fixtures.js'

let app: FastifyInstance
const auth = (key: string) => ({ authorization: `Bearer ${key}` })

beforeAll(async () => {
  app = await buildApp({ logger: false })
})

afterAll(async () => {
  await cleanup()
  await app.close()
})

describe('accounts without rights', () => {
  const venue = { name: 'V', address: 'A 1', city: 'Testcity' }

  it('get 403 no_rights on venue and extract writes', async () => {
    const { key } = await createAccount({ organizer: false })
    const calls = [
      { method: 'POST', url: '/api/v1/venues', payload: venue },
      { method: 'PUT', url: '/api/v1/venues/11111111-1111-4111-8111-111111111111', payload: { name: 'X' } },
      { method: 'POST', url: '/api/v1/events/extract', payload: {} },
      { method: 'POST', url: '/api/v1/events/extract-lineup', payload: {} },
    ] as const
    for (const c of calls) {
      const res = await app.inject({ ...c, headers: auth(key) })
      expect(res.statusCode, `${c.method} ${c.url}`).toBe(403)
      expect(res.json().error.code).toBe('no_rights')
    }
  })

  it('a member of only an unverified organizer gets 403 no_rights', async () => {
    const { key, account } = await createAccount({ organizer: false })
    await createOrganizer([account.id], { verified: false })
    const res = await app.inject({ method: 'POST', url: '/api/v1/venues', headers: auth(key), payload: venue })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('no_rights')
  })
})
