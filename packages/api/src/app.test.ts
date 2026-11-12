import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { buildApp, redactUrl, serializeReq, trustProxy } from './app.js'

describe('trustProxy', () => {
  it('trusts nothing when unset or empty', () => {
    expect(trustProxy('')).toBe(false)
    expect(trustProxy(undefined)).toBe(false)
  })

  it('keeps `true` and integer hop counts', () => {
    expect(trustProxy('true')).toBe(true)
    expect(trustProxy('1')).toBe(1)
    expect(trustProxy('0')).toBe(false)
  })

  it('passes any other value through as a trust list', () => {
    expect(trustProxy('abc,10.0.0.0/8')).toBe('abc,10.0.0.0/8')
    expect(trustProxy('loopback,linklocal,uniquelocal,100.64.0.0/10')).toBe('loopback,linklocal,uniquelocal,100.64.0.0/10')
  })
})

describe('client address behind the proxy', () => {
  const saved = process.env.TRUST_PROXY
  afterEach(() => {
    if (saved === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = saved
  })

  it('with a trust list, a client-sent X-Forwarded-For entry does not become req.ip', async () => {
    process.env.TRUST_PROXY = 'loopback,linklocal,uniquelocal,100.64.0.0/10'
    const app = await buildApp({ logger: false })
    app.get('/__ip', async (req) => ({ ip: req.ip }))
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/__ip',
        remoteAddress: '127.0.0.1',
        headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' },
      })
      expect(res.json()).toEqual({ ip: '203.0.113.7' })
    } finally {
      await app.close()
    }
  })

  it('skips internal hops after the client', async () => {
    process.env.TRUST_PROXY = 'loopback,linklocal,uniquelocal,100.64.0.0/10'
    const app = await buildApp({ logger: false })
    app.get('/__ip', async (req) => ({ ip: req.ip }))
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/__ip',
        remoteAddress: '100.64.1.1',
        headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 10.1.2.3' },
      })
      expect(res.json()).toEqual({ ip: '203.0.113.7' })
    } finally {
      await app.close()
    }
  })
})

describe('log redaction', () => {
  it('hides the calendar token', () => {
    expect(redactUrl('/cal/abc123DEF_-x.ics')).toBe('/cal/[redacted].ics')
    expect(redactUrl('/cal/abc123.ics?x=1')).toBe('/cal/[redacted].ics?x=1')
  })

  it('hides token query values and keeps other parameters', () => {
    expect(redactUrl('/api/v1/auth/verify?token=secret')).toBe('/api/v1/auth/verify?token=[redacted]')
    expect(redactUrl('/confirm?a=1&token=secret&b=2')).toBe('/confirm?a=1&token=[redacted]&b=2')
  })

  it('leaves other URLs alone', () => {
    expect(redactUrl('/api/v1/events?city=Berlin')).toBe('/api/v1/events?city=Berlin')
  })

  it('serializes the request with a redacted URL', () => {
    const req = {
      method: 'GET',
      url: '/cal/tok.ics',
      headers: {},
      host: 'api.example',
      ip: '203.0.113.7',
      socket: { remotePort: 1234 },
    } as unknown as FastifyRequest
    expect(serializeReq(req)).toMatchObject({
      method: 'GET',
      url: '/cal/[redacted].ics',
      host: 'api.example',
      remoteAddress: '203.0.113.7',
      remotePort: 1234,
    })
  })
})
