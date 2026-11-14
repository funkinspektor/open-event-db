import { eq } from 'drizzle-orm'
import type { Db } from './index.js'
import { ingestSources } from './schema.js'

/** Slug of the built-in source that every account suggestion lands in. */
export const SUGGESTIONS_SOURCE_SLUG = 'suggestions'

/**
 * Creates the built-in suggestions source when missing and returns its id. Runs on API start and in the seed,
 * not in a migration: Postgres cannot use the 'suggestion' enum value in the transaction that added it.
 */
export async function ensureSuggestionsSource(db: Db): Promise<string> {
  await db
    .insert(ingestSources)
    .values({
      slug: SUGGESTIONS_SOURCE_SLUG,
      name: 'Suggestions',
      kind: 'suggestion',
      url: 'https://kellerkompass.de/',
      official: false,
      enabled: true,
      accountId: null,
      venueId: null,
    })
    .onConflictDoNothing({ target: ingestSources.slug })
  // Only a source of kind 'suggestion' may take people's suggestions: never a feed that happens to have the slug
  const [row] = await db
    .select({ id: ingestSources.id, kind: ingestSources.kind })
    .from(ingestSources)
    .where(eq(ingestSources.slug, SUGGESTIONS_SOURCE_SLUG))
  if (!row) throw new Error('suggestions source missing after upsert')
  if (row.kind !== 'suggestion') {
    throw new Error(
      `The ingest source with slug "${SUGGESTIONS_SOURCE_SLUG}" has kind "${row.kind}", not "suggestion": rename that source's slug, then restart`,
    )
  }
  return row.id
}
