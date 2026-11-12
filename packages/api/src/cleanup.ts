import { and, isNotNull, isNull, lt, ne, or, eq, sql } from 'drizzle-orm'
import { accounts, editHistory, events, ingestSources, magicLinkTokens, organizerMembers, sessions } from '@open-event-db/db'
import { db } from './db.js'

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
