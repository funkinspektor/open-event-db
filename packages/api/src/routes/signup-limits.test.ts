import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { and, eq, gt, inArray, like, sql } from 'drizzle-orm'
import { magicLinkTokens } from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { email } from '../email.js'

const stamp = Date.now()
const outbox: { to: string; kind: string }[] = []
const lines: string[] = []
let app: FastifyInstance

const request = (address: string, ip: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/magic-link', payload: { email: address }, remoteAddress: ip })

const KEYS = [
  '203.0.113.61',
  '203.0.113.62',
  '2001:db8:aa:bb::/64',
  '203.0.113.100',
  '203.0.113.101',
  '203.0.113.102',
  '203.0.113.103',
]
const clear = async () => {
  await db.delete(magicLinkTokens).where(like(magicLinkTokens.email, `%-bs${stamp}-%@test.local`))
  await db
    .delete(magicLinkTokens)
    .where(and(eq(magicLinkTokens.kind, 'signup'), inArray(magicLinkTokens.requestIp, KEYS)))
}

beforeAll(async () => {
  email.setTransport({
    async sendMagicLink(msg) {
      outbox.push(msg)
    },
    async sendEmailChangedNotice() {},
    async sendEventLive() {},
  })
  app = await buildApp({ logger: true, logStream: { write: (l) => void lines.push(l) } })
  await clear()
})

afterAll(async () => {
  delete process.env.SIGNUP_MAILS_PER_DAY
  await clear()
  email.reset()
  await app.close()
})

describe('sign-up abuse limits', () => {
  it('counts all addresses of one IPv6 /64 as one client and maps IPv4-mapped addresses to IPv4', async () => {
    const before = outbox.length
    for (let i = 0; i < 6; i++) {
      await request(`v6-bs${stamp}-${i}@test.local`, i % 2 ? '2001:db8:aa:bb::1' : '2001:db8:aa:bb:ffff::2')
    }
    await request(`v4m-bs${stamp}-0@test.local`, '::ffff:203.0.113.62')
    await vi.waitFor(() => expect(outbox.length).toBe(before + 7))
    const rows = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.requestIp, '2001:db8:aa:bb::/64'))
    expect(rows).toHaveLength(6)
    const mapped = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.requestIp, '203.0.113.62'))
    expect(mapped).toHaveLength(1)
  })

  it('shares the per-IP cap across a /64 and logs a capped sign-up without any address', async () => {
    lines.length = 0
    const before = outbox.length
    // 4 more from the /64 reach its cap of 10 (6 above), the next 2 are capped
    for (let i = 6; i < 12; i++) {
      const res = await request(`v6-bs${stamp}-${i}@test.local`, `2001:db8:aa:bb:${i}::${i}`)
      expect(res.statusCode).toBe(200)
    }
    await vi.waitFor(() => expect(lines.some((l) => l.includes('"signupCapped":true'))).toBe(true))
    await new Promise((r) => setTimeout(r, 200))
    expect(outbox.length).toBe(before + 4)
    const capped = lines.filter((l) => l.includes('signupCapped')).join('')
    expect(capped).not.toMatch(/test\.local|2001|db8/)
  })

  it('stops sending sign-up mails at the global daily backstop and logs it without the address', async () => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(magicLinkTokens)
      .where(and(eq(magicLinkTokens.kind, 'signup'), gt(magicLinkTokens.createdAt, new Date(Date.now() - 24 * 3_600_000))))
    process.env.SIGNUP_MAILS_PER_DAY = String((row?.n ?? 0) + 2)
    lines.length = 0
    const before = outbox.length
    const bodies: unknown[] = []
    for (let i = 0; i < 4; i++) {
      // each from its own IP, so no per-IP cap is involved
      const res = await request(`back-bs${stamp}-${i}@test.local`, `203.0.113.${100 + i}`)
      expect(res.statusCode).toBe(200)
      bodies.push(res.json())
    }
    await vi.waitFor(() => expect(lines.some((l) => l.includes('"signupBackstop":true'))).toBe(true))
    await new Promise((r) => setTimeout(r, 200))
    expect(outbox.length).toBe(before + 2)
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1)
    expect(lines.filter((l) => l.includes('signupBackstop')).join('')).not.toMatch(/test\.local|203\.0\.113\./)
  })
})
