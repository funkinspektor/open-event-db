import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { ingestItems, ingestSources, venues } from '@open-event-db/db'
import { ingestDraftSchema, type IngestDraft } from '@open-event-db/shared'
import { db } from '../../db.js'
import { draftStartsAt, isOpen } from '../open.js'
import { buildPrompt, fingerprint, subjectOf, type FitExamples, type FitSubject } from './prompt.js'
import { fitScoring } from './scorer.js'

export interface ScoreOptions {
  /** Source slugs to score; default: all. */
  only?: string[]
  /** Most items per pass, soonest start first. */
  limit?: number
  /** Most model calls in flight at once. */
  concurrency?: number
}

export interface ScoreResult {
  skipped?: 'no model'
  scored: number
  fit: number
  maybe: number
  no: number
  failed: number
}

const DEFAULT_LIMIT = 200
const DEFAULT_CONCURRENCY = 4
const EXAMPLE_COUNT = 20

/** Joins the draft's venue as text: a broken stored venue_id must not make the uuid cast fail the whole query. */
const venueJoin = sql`${venues.id}::text = ${ingestItems.draft}->>'venue_id'`

/** The editors' latest decisions, newest first: what they took and what they turned down. */
export async function selectExamples(opts: { only?: string[] } = {}): Promise<FitExamples> {
  const recent = async (decided: 'accepted' | 'rejected'): Promise<FitSubject[]> => {
    const rows = await db
      .select({ id: ingestItems.id, draft: ingestItems.draft, venueName: venues.name, sourceName: ingestSources.name })
      .from(ingestItems)
      .innerJoin(ingestSources, eq(ingestSources.id, ingestItems.sourceId))
      .leftJoin(venues, venueJoin)
      .where(
        and(
          eq(ingestItems.status, decided),
          // A duplicate merged into one item says little about the editors' taste
          decided === 'rejected' ? eq(ingestItems.hadDuplicates, false) : undefined,
          opts.only ? inArray(ingestSources.slug, opts.only) : undefined,
        ),
      )
      .orderBy(desc(ingestItems.decidedAt), asc(ingestItems.id))
      .limit(EXAMPLE_COUNT)
    return rows.flatMap((row) => {
      const parsed = ingestDraftSchema.safeParse(row.draft)
      return parsed.success ? [subjectOf(parsed.data, row.venueName, row.sourceName)] : []
    })
  }
  const [accepted, rejected] = await Promise.all([recent('accepted'), recent('rejected')])
  return { accepted, rejected }
}

interface Candidate {
  id: string
  subject: FitSubject
  fingerprint: string
}

/** Open items whose verdict is missing or based on an older fingerprint, soonest start first. */
async function selectCandidates(only: string[] | undefined, limit: number): Promise<Candidate[]> {
  const rows = await db
    .select({ id: ingestItems.id, draft: ingestItems.draft, fitFingerprint: ingestItems.fitFingerprint, venueName: venues.name, sourceName: ingestSources.name })
    .from(ingestItems)
    .innerJoin(ingestSources, eq(ingestSources.id, ingestItems.sourceId))
    .leftJoin(venues, venueJoin)
    .where(and(isOpen(), only ? inArray(ingestSources.slug, only) : undefined))
    .orderBy(asc(draftStartsAt), asc(ingestItems.id))

  const candidates: Candidate[] = []
  for (const row of rows) {
    const parsed = ingestDraftSchema.safeParse(row.draft)
    if (!parsed.success) {
      console.warn({ itemId: row.id, err: parsed.error.message })
      continue
    }
    const draft: IngestDraft = parsed.data
    const subject = subjectOf(draft, row.venueName, row.sourceName)
    const print = fingerprint(subject)
    if (print !== row.fitFingerprint) candidates.push({ id: row.id, subject, fingerprint: print })
  }
  return candidates.slice(0, limit)
}

/**
 * Asks the model whether open inbox items fit the platform, one call each, and stores the verdict.
 * Shadow only: nothing is accepted, rejected or hidden on the strength of it. A failed call writes nothing,
 * so the item is tried again in the next pass.
 */
export async function scorePending(opts: ScoreOptions = {}): Promise<ScoreResult> {
  const result: ScoreResult = { scored: 0, fit: 0, maybe: 0, no: 0, failed: 0 }
  const scorer = fitScoring.scorer
  if (!scorer) return { skipped: 'no model', ...result }

  const candidates = await selectCandidates(opts.only, opts.limit ?? DEFAULT_LIMIT)
  if (!candidates.length) return result
  const examples = await selectExamples()

  const scoreOne = async ({ id, subject, fingerprint: print }: Candidate) => {
    try {
      const judgement = await scorer.score(buildPrompt(subject, examples))
      // An item decided while the call was out keeps its decision and stays unscored
      const written = await db
        .update(ingestItems)
        .set({ fitVerdict: judgement.verdict, fitReason: judgement.reason, fitScoredAt: new Date(), fitFingerprint: print })
        .where(and(eq(ingestItems.id, id), eq(ingestItems.status, 'pending')))
        .returning({ id: ingestItems.id })
      if (!written.length) return
      result.scored++
      result[judgement.verdict]++
    } catch (err) {
      console.warn({ itemId: id, err })
      result.failed++
    }
  }

  // A small worker pool: each worker takes the next candidate until none are left
  let next = 0
  const worker = async () => {
    while (next < candidates.length) await scoreOne(candidates[next++]!)
  }
  const workers = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, candidates.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return result
}
