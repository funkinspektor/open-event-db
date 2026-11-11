import { randomBytes } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import {
  accounts,
  editHistory,
  events,
  generateApiKey,
  ingestSources,
  organizerMembers,
  organizers,
  type Account,
  type Organizer,
} from '@open-event-db/db'
import { db } from '../db.js'

const accountIds: string[] = []
const organizerIds: string[] = []

const unique = () => randomBytes(5).toString('hex')

/** An organizer with the given accounts as members; the first is owner, the rest members. */
export async function createOrganizer(
  memberIds: string[],
  opts: { verified?: boolean } = {},
): Promise<Organizer> {
  const u = unique()
  const [organizer] = await db
    .insert(organizers)
    .values({ name: `Test Organizer ${u}`, slug: `test-org-${u}`, verified: opts.verified ?? true })
    .returning()
  if (!organizer) throw new Error('insert returned no row')
  organizerIds.push(organizer.id)
  if (memberIds.length > 0) {
    await db
      .insert(organizerMembers)
      .values(memberIds.map((accountId, i) => ({ organizerId: organizer.id, accountId, role: i === 0 ? ('owner' as const) : ('member' as const) })))
  }
  return organizer
}

/**
 * An account with an API key. By default it owns a verified organizer; pass `organizer: false` for
 * none, or `{ verified: false }` for an unverified one.
 */
export async function createAccount(
  opts: { scout?: boolean; organizer?: { verified?: boolean } | false; label?: string; onboarded?: boolean } = {},
): Promise<{ account: Account; key: string; organizer: Organizer | null }> {
  const u = unique()
  const { key, hash } = generateApiKey()
  const label = opts.label ?? 'tester'
  const [account] = await db
    .insert(accounts)
    .values({
      email: `${label}-${u}@test.local`,
      handle: `${label}-${u}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      displayName: `Test ${label} ${u}`,
      isScout: opts.scout ?? false,
      apiKeyHash: hash,
      onboardedAt: opts.onboarded === false ? null : new Date(),
    })
    .returning()
  if (!account) throw new Error('insert returned no row')
  accountIds.push(account.id)
  const organizer =
    opts.organizer === false ? null : await createOrganizer([account.id], opts.organizer ?? {})
  return { account, key, organizer }
}

/** Removes everything the helpers created, in FK-safe order. */
export async function cleanup(): Promise<void> {
  if (accountIds.length > 0) {
    // ingest_sources.account_id restricts account deletion; their items cascade
    await db.delete(ingestSources).where(inArray(ingestSources.accountId, accountIds))
    await db.delete(editHistory).where(inArray(editHistory.accountId, accountIds))
    // event_organizers rows go with the events
    await db.delete(events).where(inArray(events.createdBy, accountIds))
  }
  if (organizerIds.length > 0) {
    await db.delete(editHistory).where(inArray(editHistory.entityId, organizerIds))
    await db.delete(organizerMembers).where(inArray(organizerMembers.organizerId, organizerIds))
    await db.delete(organizers).where(inArray(organizers.id, organizerIds))
  }
  if (accountIds.length > 0) {
    // sessions and magic-link tokens cascade
    await db.delete(accounts).where(inArray(accounts.id, accountIds))
  }
  accountIds.length = 0
  organizerIds.length = 0
}
