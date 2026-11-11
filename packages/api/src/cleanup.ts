import { and, isNotNull, lt, ne, or, eq } from 'drizzle-orm'
import { magicLinkTokens, sessions } from '@open-event-db/db'
import { db } from './db.js'

export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

const SIGNUP_TOKEN_KEEP_MS = 24 * 60 * 60 * 1000

/**
 * Deletes expired or already-used magic-link tokens and expired sessions. Sign-up tokens stay for 24 hours
 * after creation, because they are what the per-IP sign-up cap counts.
 */
export async function cleanupExpiredAuth(now = new Date()): Promise<{ tokens: number; sessions: number }> {
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
  return { tokens: tokens.length, sessions: expired.length }
}
