import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteAccount, soleMemberships } from './accounts.js'
import { createDb } from './index.js'
import {
  accounts,
  editHistory,
  eventInterests,
  events,
  ingestItems,
  ingestSources,
  magicLinkTokens,
  organizerMembers,
  organizers,
  sessions,
} from './schema.js'

const db = createDb(process.env.DATABASE_URL ?? 'postgres://oedb:oedb@localhost:5432/oedb')
const tag = Math.random().toString(36).slice(2, 8)

let victimId = ''
let otherId = ''
let soleOrgId = ''
let sharedOrgId = ''
let suggestionSourceId = ''
let ownEventId = ''
let otherEventId = ''

beforeAll(async () => {
  const [v, o] = await db
    .insert(accounts)
    .values([
      {
        handle: `acct-test-v-${tag}`,
        email: `v-${tag}@example.test`,
        displayName: 'Victim',
        isScout: true,
        calendarToken: `cal-${tag}`,
        onboardedAt: new Date(),
        termsAcceptedAt: new Date(),
      },
      { handle: `acct-test-o-${tag}`, email: `o-${tag}@example.test`, displayName: 'Other' },
    ])
    .returning({ id: accounts.id })
  victimId = v!.id
  otherId = o!.id
  const orgs = await db
    .insert(organizers)
    .values([
      { name: 'Sole', slug: `acct-sole-${tag}` },
      { name: 'Shared', slug: `acct-shared-${tag}` },
    ])
    .returning({ id: organizers.id, slug: organizers.slug })
  soleOrgId = orgs.find((x) => x.slug.startsWith('acct-sole'))!.id
  sharedOrgId = orgs.find((x) => x.slug.startsWith('acct-shared'))!.id
  await db.insert(organizerMembers).values([
    { organizerId: soleOrgId, accountId: victimId, role: 'owner' },
    { organizerId: sharedOrgId, accountId: victimId, role: 'owner' },
    { organizerId: sharedOrgId, accountId: otherId, role: 'member' },
  ])
  const evs = await db
    .insert(events)
    .values([
      { title: 'Own', startsAt: new Date('2030-01-01T20:00:00Z'), city: 'Berlin', createdBy: victimId },
      { title: 'Other', startsAt: new Date('2030-01-02T20:00:00Z'), city: 'Berlin', createdBy: otherId },
    ])
    .returning({ id: events.id, title: events.title })
  ownEventId = evs.find((e) => e.title === 'Own')!.id
  otherEventId = evs.find((e) => e.title === 'Other')!.id
  await db.insert(eventInterests).values([
    { accountId: victimId, eventId: otherEventId },
    { accountId: otherId, eventId: ownEventId },
  ])
  const [src] = await db
    .insert(ingestSources)
    .values({ slug: `acct-sugg-${tag}`, name: 'Suggestions test', kind: 'suggestion', url: 'https://example.test/', official: false })
    .returning({ id: ingestSources.id })
  suggestionSourceId = src!.id
  await db.insert(ingestItems).values([
    { sourceId: suggestionSourceId, externalId: `p-${tag}`, status: 'pending', draft: {}, raw: '', submittedBy: victimId },
    { sourceId: suggestionSourceId, externalId: `r-${tag}`, status: 'rejected', draft: {}, raw: '', submittedBy: victimId },
    { sourceId: suggestionSourceId, externalId: `o-${tag}`, status: 'pending', draft: {}, raw: '', submittedBy: otherId },
  ])
  const expiresAt = new Date(Date.now() + 1e6)
  await db.insert(sessions).values({ accountId: victimId, tokenHash: `s-${tag}`, expiresAt })
  await db
    .insert(magicLinkTokens)
    .values([
      { accountId: victimId, email: `v-${tag}@example.test`, tokenHash: `m-${tag}`, expiresAt },
      // sign-up token for the address, not tied to the account; other casing
      { accountId: null, kind: 'signup', email: `V-${tag}@Example.test`, tokenHash: `ms-${tag}`, expiresAt },
      { accountId: otherId, kind: 'email_change', email: `v-${tag}@example.test`, newEmail: `v-${tag}@example.test`, tokenHash: `me-${tag}`, expiresAt },
      { accountId: otherId, email: `o-${tag}@example.test`, tokenHash: `mo-${tag}`, expiresAt },
    ])
})

afterAll(async () => {
  await db.delete(ingestSources).where(eq(ingestSources.id, suggestionSourceId))
  await db.delete(events).where(inArray(events.id, [ownEventId, otherEventId]))
  await db.delete(organizers).where(inArray(organizers.id, [soleOrgId, sharedOrgId]))
  await db.delete(editHistory).where(inArray(editHistory.accountId, [victimId, otherId]))
  await db.delete(accounts).where(inArray(accounts.id, [victimId, otherId]))
})

describe('accounts', () => {
  it('soleMemberships lists only organizers where the account is the only member', async () => {
    const sole = await soleMemberships(db, victimId)
    expect(sole.map((o) => o.id)).toEqual([soleOrgId])
  })

  it('deleteAccount anonymises the account and keeps its events', async () => {
    const res = await deleteAccount(db, victimId)
    expect(res.orphanedOrganizers.map((o) => o.id)).toEqual([soleOrgId])
    expect(res.eventCount).toBe(1)

    const [a] = await db.select().from(accounts).where(eq(accounts.id, victimId))
    expect(a!.handle).toBe(`deleted-${victimId}`)
    expect(a!.email).toBe(`deleted-${victimId}@invalid`)
    expect(a!.displayName).toBe('Deleted account')
    expect(a!.isScout).toBe(false)
    expect(a!.calendarToken).toBeNull()
    expect(a!.onboardedAt).not.toBeNull()
    expect(a!.termsAcceptedAt).not.toBeNull()
    expect(await db.select().from(sessions).where(eq(sessions.accountId, victimId))).toHaveLength(0)
    expect(await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.accountId, victimId))).toHaveLength(0)
    const left = await db.select({ h: magicLinkTokens.tokenHash }).from(magicLinkTokens).where(inArray(magicLinkTokens.tokenHash, [`m-${tag}`, `ms-${tag}`, `me-${tag}`, `mo-${tag}`]))
    expect(left.map((r) => r.h)).toEqual([`mo-${tag}`])
    const [h] = await db.select().from(editHistory).where(eq(editHistory.entityId, victimId))
    expect(h!.diff).toEqual({ via: 'cli' })
    expect(await db.select().from(organizerMembers).where(eq(organizerMembers.accountId, victimId))).toHaveLength(0)
    expect(await db.select().from(eventInterests).where(eq(eventInterests.accountId, victimId))).toHaveLength(0)
    const [ev] = await db.select().from(events).where(eq(events.id, ownEventId))
    expect(ev!.createdBy).toBe(victimId)
    // other accounts' interests are untouched
    expect(await db.select().from(eventInterests).where(eq(eventInterests.accountId, otherId))).toHaveLength(1)
  })

  it('deleteAccount withdraws pending suggestions and keeps decided ones', async () => {
    await deleteAccount(db, victimId)
    const rows = await db
      .select({ externalId: ingestItems.externalId, status: ingestItems.status })
      .from(ingestItems)
      .where(eq(ingestItems.sourceId, suggestionSourceId))
    const byId = Object.fromEntries(rows.map((r) => [r.externalId.split('-')[0], r.status]))
    expect(byId).toEqual({ p: 'withdrawn', r: 'rejected', o: 'pending' })
  })
})
