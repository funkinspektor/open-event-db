import { isNotNull, lt, or } from 'drizzle-orm'
import { magicLinkTokens, sessions } from '@open-event-db/db'
import { db } from './db.js'

export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

/** Deletes expired or already-used magic-link tokens and expired sessions. */
export async function cleanupExpiredAuth(now = new Date()): Promise<{ tokens: number; sessions: number }> {
  const tokens = await db
    .delete(magicLinkTokens)
    .where(or(lt(magicLinkTokens.expiresAt, now), isNotNull(magicLinkTokens.usedAt)))
    .returning({ id: magicLinkTokens.id })
  const expired = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id })
  return { tokens: tokens.length, sessions: expired.length }
}
