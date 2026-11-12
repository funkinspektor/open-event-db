import { afterAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { accounts, eventInterests, events, generateToken, magicLinkTokens, sessions } from '@open-event-db/db'
import { db } from './db.js'
import { cleanupExpiredAuth } from './cleanup.js'
import { cleanup, createAccount } from './test/fixtures.js'

afterAll(async () => {
  await cleanup()
})

const DAY = 24 * 3_600_000
const age = (id: string, days: number) =>
  db.update(accounts).set({ createdAt: new Date(Date.now() - days * DAY) }).where(eq(accounts.id, id))
const exists = async (id: string) => (await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id))).length === 1

describe('cleanup of accounts that never finished onboarding', () => {
  it('removes old unonboarded accounts with their sessions, tokens and interests; keeps the rest', async () => {
    const { account: host } = await createAccount({ label: 'host', organizer: false })
    const [event] = await db
      .insert(events)
      .values({ title: 'Cleanup event', startsAt: new Date(Date.now() + DAY), city: 'Berlin', createdBy: host.id })
      .returning()

    const old = (await createAccount({ label: 'oldnew', organizer: false, onboarded: false })).account
    const fresh = (await createAccount({ label: 'freshnew', organizer: false, onboarded: false })).account
    const onboarded = (await createAccount({ label: 'oldonb', organizer: false })).account
    const referenced = (await createAccount({ label: 'oldref', organizer: false, onboarded: false })).account
    for (const a of [old, onboarded, referenced]) await age(a.id, 8)
    await age(fresh.id, 6)

    await db.insert(events).values({ title: 'Referencing', startsAt: new Date(Date.now() + DAY), city: 'Berlin', createdBy: referenced.id })
    const s = generateToken()
    await db.insert(sessions).values({ accountId: old.id, tokenHash: s.hash, expiresAt: new Date(Date.now() + DAY) })
    const t = generateToken()
    await db
      .insert(magicLinkTokens)
      .values({ accountId: old.id, email: old.email, kind: 'login', tokenHash: t.hash, expiresAt: new Date(Date.now() + DAY) })
    await db.insert(eventInterests).values({ accountId: old.id, eventId: event!.id })

    const removed = await cleanupExpiredAuth()
    expect(removed.accounts).toBeGreaterThanOrEqual(1)

    expect(await exists(old.id)).toBe(false)
    expect(await db.select().from(sessions).where(eq(sessions.accountId, old.id))).toHaveLength(0)
    expect(await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.accountId, old.id))).toHaveLength(0)
    expect(await db.select().from(eventInterests).where(eq(eventInterests.accountId, old.id))).toHaveLength(0)

    expect(await exists(fresh.id)).toBe(true)
    expect(await exists(onboarded.id)).toBe(true)
    expect(await exists(referenced.id)).toBe(true)
    expect(await exists(host.id)).toBe(true)
    // nothing left to delete the second time
    await cleanupExpiredAuth()
    expect(await db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, [fresh.id, onboarded.id, referenced.id]))).toHaveLength(3)
  })
})
