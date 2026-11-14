import { and, inArray, isNotNull, isNull, lt, ne, or, eq, sql } from 'drizzle-orm'
import { accounts, editHistory, events, ingestItems, ingestSources, magicLinkTokens, organizerMembers, sessions } from '@open-event-db/db'
import { db } from './db.js'
import { imageStore } from './images/store.js'

export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

const SIGNUP_TOKEN_KEEP_MS = 24 * 60 * 60 * 1000
/** An account is created when the sign-up link is opened; without /welcome in this long it is dropped. */
const UNONBOARDED_KEEP_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Deletes expired or already-used magic-link tokens, expired sessions and accounts that never finished
 * onboarding. Sign-up tokens stay for 24 hours after creation, because they are what the per-IP sign-up cap
 * counts.
 *
 * An unonboarded account is hard-deleted after 7 days, but only if nothing references it besides what
 * cascades (sessions, tokens, interests): events, edit history, ingest sources and organizer memberships
 * keep it alive, so the delete can never fail on a foreign key.
 */
export async function cleanupExpiredAuth(now = new Date()): Promise<{ tokens: number; sessions: number; accounts: number }> {
  const tokens = await db
    .delete(magicLinkTokens)
    .where(
      or(
        and(
          ne(magicLinkTokens.kind, 'signup'),
          or(lt(magicLinkTokens.expiresAt, now), isNotNull(magicLinkTokens.usedAt)),
        ),
        and(eq(magicLinkTokens.kind, 'signup'), lt(magicLinkTokens.createdAt, new Date(now.getTime() - SIGNUP_TOKEN_KEEP_MS))),
      ),
    )
    .returning({ id: magicLinkTokens.id })
  const expired = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id })
  const stale = await db
    .delete(accounts)
    .where(
      and(
        isNull(accounts.onboardedAt),
        lt(accounts.createdAt, new Date(now.getTime() - UNONBOARDED_KEEP_MS)),
        sql`not exists (select 1 from ${events} where ${events.createdBy} = ${accounts.id})`,
        sql`not exists (select 1 from ${editHistory} where ${editHistory.accountId} = ${accounts.id})`,
        sql`not exists (select 1 from ${ingestSources} where ${ingestSources.accountId} = ${accounts.id})`,
        sql`not exists (select 1 from ${organizerMembers} where ${organizerMembers.accountId} = ${accounts.id})`,
      ),
    )
    .returning({ id: accounts.id })
  return { tokens: tokens.length, sessions: expired.length, accounts: stale.length }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Deletes the images people uploaded with suggestions that are no longer needed: withdrawn ones at once,
 * rejected or accepted ones (an accept keeps the upload when copying it to the event failed) once they were
 * decided `SUGGESTION_IMAGE_KEEP_DAYS` (default 30) ago. Only items of the suggestions source are touched.
 *
 * The object goes first; the key and the draft's image URL are cleared only after a successful delete, so a
 * failed delete is logged and retried on the next run. Returns how many images were deleted.
 */
export async function cleanupSuggestionImages(now = new Date()): Promise<number> {
  const store = imageStore.store
  if (!store) return 0
  const parsed = Number(process.env.SUGGESTION_IMAGE_KEEP_DAYS)
  const keepDays = process.env.SUGGESTION_IMAGE_KEEP_DAYS && Number.isFinite(parsed) && parsed >= 0 ? parsed : 30
  const cutoff = new Date(now.getTime() - keepDays * DAY_MS)
  const rows = await db
    .select({ id: ingestItems.id, imageKey: ingestItems.imageKey })
    .from(ingestItems)
    .innerJoin(ingestSources, eq(ingestSources.id, ingestItems.sourceId))
    .where(
      and(
        eq(ingestSources.kind, 'suggestion'),
        isNotNull(ingestItems.imageKey),
        or(
          eq(ingestItems.status, 'withdrawn'),
          and(inArray(ingestItems.status, ['rejected', 'accepted']), lt(ingestItems.decidedAt, cutoff)),
        ),
      ),
    )
  let deleted = 0
  for (const row of rows) {
    const key = row.imageKey
    if (!key) continue
    try {
      await store.delete(key)
      await db
        .update(ingestItems)
        .set({ imageKey: null, draft: sql`jsonb_set(${ingestItems.draft}, '{image_url}', 'null'::jsonb)` })
        .where(and(eq(ingestItems.id, row.id), eq(ingestItems.imageKey, key)))
      deleted++
    } catch (err) {
      console.warn(`Could not delete the image ${key} of suggestion ${row.id}:`, err instanceof Error ? err.message : err)
    }
  }
  return deleted
}
