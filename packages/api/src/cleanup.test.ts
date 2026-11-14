import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { accounts, eventInterests, events, generateToken, ingestItems, magicLinkTokens, sessions, ensureSuggestionsSource } from '@open-event-db/db'
import { db } from './db.js'
import { cleanupExpiredAuth, cleanupSuggestionImages } from './cleanup.js'
import { imageStore, memoryImageStore } from './images/store.js'
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

describe('cleanup of suggestion images', () => {
  const made: string[] = []
  afterEach(async () => {
    delete process.env.SUGGESTION_IMAGE_KEEP_DAYS
    imageStore.reset()
    if (made.length) await db.delete(ingestItems).where(inArray(ingestItems.id, made.splice(0)))
  })

  it('deletes images of withdrawn suggestions now and of rejected or accepted ones after the keep period', async () => {
    const store = memoryImageStore()
    imageStore.setStore(store)
    const sourceId = await ensureSuggestionsSource(db)
    const mk = async (name: string, status: 'pending' | 'withdrawn' | 'rejected' | 'accepted', decidedDaysAgo: number | null) => {
      const key = `suggestions/${name}/${crypto.randomUUID()}.jpg`
      await store.put(key, Buffer.from('x'), 'image/jpeg')
      const [row] = await db
        .insert(ingestItems)
        .values({
          sourceId,
          externalId: `cleanup-${name}-${crypto.randomUUID()}`,
          status,
          draft: { title: name, image_url: store.url(key) },
          raw: '',
          imageKey: key,
          decidedAt: decidedDaysAgo === null ? null : new Date(Date.now() - decidedDaysAgo * DAY),
        })
        .returning()
      made.push(row!.id)
      return { id: row!.id, key }
    }
    const withdrawn = await mk('withdrawn', 'withdrawn', null)
    const rejectedOld = await mk('rejold', 'rejected', 31)
    const rejectedNew = await mk('rejnew', 'rejected', 29)
    const acceptedOld = await mk('accold', 'accepted', 31)
    const acceptedNew = await mk('accnew', 'accepted', 29)
    const pending = await mk('pending', 'pending', null)
    const get = async (id: string) => (await db.select().from(ingestItems).where(eq(ingestItems.id, id)))[0]!

    expect(await cleanupSuggestionImages()).toBe(3)
    for (const gone of [withdrawn, rejectedOld, acceptedOld]) {
      expect(store.objects.has(gone.key)).toBe(false)
      const row = await get(gone.id)
      expect(row.imageKey).toBeNull()
      expect((row.draft as { image_url: unknown }).image_url).toBeNull()
    }
    for (const kept of [rejectedNew, acceptedNew, pending]) {
      expect(store.objects.has(kept.key)).toBe(true)
      expect((await get(kept.id)).imageKey).toBe(kept.key)
    }

    process.env.SUGGESTION_IMAGE_KEEP_DAYS = '10'
    const eleven = await mk('eleven', 'rejected', 11)
    expect(await cleanupSuggestionImages()).toBe(3) // rejectedNew (29), acceptedNew (29) and eleven (11)
    expect(store.objects.has(eleven.key)).toBe(false)
    expect(store.objects.has(pending.key)).toBe(true)
  })

  it('keeps the key when the delete fails, so the next run retries', async () => {
    const store = memoryImageStore()
    imageStore.setStore(store)
    const sourceId = await ensureSuggestionsSource(db)
    const key = `suggestions/failing/${crypto.randomUUID()}.jpg`
    await store.put(key, Buffer.from('x'), 'image/jpeg')
    const [row] = await db
      .insert(ingestItems)
      .values({ sourceId, externalId: `cleanup-fail-${crypto.randomUUID()}`, status: 'withdrawn', draft: { image_url: store.url(key) }, raw: '', imageKey: key })
      .returning()
    made.push(row!.id)
    const realDelete = store.delete
    store.delete = async () => {
      throw new Error('boom')
    }
    expect(await cleanupSuggestionImages()).toBe(0)
    expect((await db.select().from(ingestItems).where(eq(ingestItems.id, row!.id)))[0]!.imageKey).toBe(key)
    store.delete = realDelete
    expect(await cleanupSuggestionImages()).toBe(1)
  })
})
