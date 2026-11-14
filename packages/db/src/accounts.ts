import { and, eq, sql } from 'drizzle-orm'
import type { Db } from './index.js'
import {
  accounts,
  editHistory,
  eventInterests,
  events,
  ingestItems,
  magicLinkTokens,
  organizerMembers,
  organizers,
  sessions,
} from './schema.js'

type OrganizerRef = { id: string; name: string; slug: string }

/** Organizers where this account is the only member: they stay public, without members, once it is deleted. */
export async function soleMemberships(db: Db, accountId: string): Promise<OrganizerRef[]> {
  const rows = await db
    .select({
      id: organizers.id,
      name: organizers.name,
      slug: organizers.slug,
      members: sql<number>`(select count(*)::int from organizer_members om where om.organizer_id = ${organizers.id})`,
    })
    .from(organizerMembers)
    .innerJoin(organizers, eq(organizers.id, organizerMembers.organizerId))
    .where(eq(organizerMembers.accountId, accountId))
  return rows.filter((m) => m.members === 1).map(({ id, name, slug }) => ({ id, name, slug }))
}

/**
 * Events, feed sources and edit history reference the account row (onDelete: restrict), so the row stays as
 * an anonymous placeholder: "Added by" then reads "Deleted account". Everything personal is removed.
 */
export async function deleteAccount(
  db: Db,
  accountId: string,
  opts: { via?: 'cli' | 'self' } = {},
): Promise<{ orphanedOrganizers: OrganizerRef[]; eventCount: number }> {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db
    const orphanedOrganizers = await soleMemberships(txDb, accountId)
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .where(eq(events.createdBy, accountId))
    await tx.delete(sessions).where(eq(sessions.accountId, accountId))
    await tx.delete(magicLinkTokens).where(eq(magicLinkTokens.accountId, accountId))
    // Sign-up and email-change tokens carry the address but may not point at the account
    const [current] = await tx.select({ email: accounts.email }).from(accounts).where(eq(accounts.id, accountId))
    if (current) {
      await tx.delete(magicLinkTokens).where(sql`lower(${magicLinkTokens.email}) = ${current.email.toLowerCase()}`)
    }
    await tx.delete(organizerMembers).where(eq(organizerMembers.accountId, accountId))
    await tx.delete(eventInterests).where(eq(eventInterests.accountId, accountId))
    // Pending suggestions leave the inbox; decided ones stay as the record of what the scouts did
    await tx
      .update(ingestItems)
      .set({ status: 'withdrawn' })
      .where(and(eq(ingestItems.submittedBy, accountId), eq(ingestItems.status, 'pending')))
    // Profile history holds their old names
    await tx.delete(editHistory).where(and(eq(editHistory.entityType, 'account'), eq(editHistory.entityId, accountId)))
    await tx
      .update(accounts)
      .set({
        displayName: 'Deleted account',
        handle: `deleted-${accountId}`,
        // Unique and NOT NULL; the reserved .invalid TLD can never receive mail
        email: `deleted-${accountId}@invalid`,
        isScout: false,
        apiKeyHash: null,
        calendarToken: null,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId))
    await tx.insert(editHistory).values({
      entityType: 'account',
      entityId: accountId,
      accountId,
      action: 'deleted',
      diff: { via: opts.via ?? 'cli' },
    })
    return { orphanedOrganizers, eventCount: row?.count ?? 0 }
  })
}
