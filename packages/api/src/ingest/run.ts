import { and, asc, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm'
import {
  events,
  ingestItems,
  ingestSources,
  venues,
  type Event,
  type IngestItem,
  type IngestSource,
} from '@open-event-db/db'
import {
  ingestDraftSchema,
  ingestSourceConfigSchema,
  type Extraction,
  type IngestDraft,
  type IngestSourceConfig,
} from '@open-event-db/shared'
import { db } from '../db.js'
import { textExtraction } from '../extract/text.js'
import { ExtractionError } from '../extract/vision.js'
import { berlinInstant, berlinToday, fmtDay, nextDay, type CalendarDay } from '../extract/normalize.js'
import { diff, logEdit, type DbOrTx } from '../history.js'
import { eventSnapshot } from '../queries/events.js'
import { parseIcal, type FeedEvent } from './adapters/ical.js'
import { normalizeFeedEvent } from './normalize.js'

export interface SourceRunResult {
  slug: string
  ok: boolean
  error?: string
  seen: number
  created: number
  updated: number
  synced: number
  gone: number
}

export interface RunIngestOptions {
  /** Run only this source (or these sources), enabled or not. Default: every enabled source. */
  only?: string | string[]
  now?: Date
  fetchText?: (url: string) => Promise<string>
}

const FETCH_TIMEOUT_MS = 20_000
const USER_AGENT = 'Kellerkompass-Ingest (+https://kellerkompass.de)'

async function fetchFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Feed answered HTTP ${res.status}`)
  return res.text()
}

function addDays({ year, month, day }: CalendarDay, days: number): CalendarDay {
  const d = new Date(Date.UTC(year, month - 1, day + days))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/** The Berlin days a run asks the feed for: today through today + horizon_days. */
function runWindow(config: IngestSourceConfig, now: Date): { from: CalendarDay; to: CalendarDay } {
  const from = berlinToday(now)
  return { from, to: addDays(from, config.horizon_days) }
}

/** The source URL with `{from}` / `{to}` filled in as Berlin `YYYY-MM-DD` dates. */
export function feedUrl(source: IngestSource, now: Date): string {
  const { from, to } = runWindow(ingestSourceConfigSchema.parse(source.config), now)
  return source.url.replaceAll('{from}', fmtDay(from)).replaceAll('{to}', fmtDay(to))
}

/**
 * Times from the description text, if the source asks for it. A failed call yields null, so the next run
 * retries. Extraction that is not configured at all fails the source: it would never succeed.
 */
async function extractTimes(ev: FeedEvent, config: IngestSourceConfig): Promise<{ extraction: Extraction | null; failed: boolean }> {
  if (!config.extract_from_text || !ev.description.trim()) return { extraction: null, failed: false }
  try {
    return { extraction: await textExtraction.extractor.extract(ev.description), failed: false }
  } catch (err) {
    if (err instanceof ExtractionError && err.kind === 'unavailable') {
      throw new Error(`Source sets extract_from_text, but text extraction is unavailable: ${err.message}`)
    }
    return { extraction: null, failed: true }
  }
}

/**
 * Copies the synced fields of a draft onto its accepted event and logs the change as an ingest edit.
 * Writes `events` directly: the event routes would detach the item. Returns whether anything changed.
 */
async function syncEvent(tx: DbOrTx, source: IngestSource, eventId: string, draft: IngestDraft): Promise<boolean> {
  const [current] = await tx.select().from(events).where(eq(events.id, eventId)).for('update')
  if (!current) return false

  let venueId = draft.venue_id
  let locationText = draft.location_text
  let city = current.city
  if (venueId) {
    const [venue] = await tx.select({ city: venues.city }).from(venues).where(eq(venues.id, venueId))
    if (!venue) {
      // The mapped venue was deleted: keep a readable place, as accept does.
      venueId = null
      locationText = draft.location_text ?? source.name
    } else if (venueId !== current.venueId) {
      city = venue.city // as PUT /events/:id does when the venue changes
    }
  }

  // Only the website comes from the feed; other links on the event stay.
  const links = { ...current.links }
  if (draft.links.website) links.website = draft.links.website
  else delete links.website

  const patch = {
    title: draft.title,
    description: draft.description,
    startsAt: new Date(draft.starts_at),
    endsAt: draft.ends_at ? new Date(draft.ends_at) : null,
    venueId,
    locationText,
    city,
    links,
  } satisfies Partial<Event>
  const changes = diff(eventSnapshot(current), eventSnapshot({ ...current, ...patch }))
  if (Object.keys(changes).length === 0) return false

  await tx
    .update(events)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(events.id, eventId))
  await logEdit(tx, {
    entityType: 'event',
    entityId: eventId,
    publisherId: source.publisherId,
    action: 'updated',
    diff: { ...changes, via: 'ingest' },
  })
  return true
}

/** Clears a gone mark when the item is back in the feed, including an earlier "keep" decision. */
const reappeared = (item: IngestItem) => (item.goneAt ? { goneAt: null, goneResolvedAt: null } : {})

async function ingestEvent(
  source: IngestSource,
  config: IngestSourceConfig,
  ev: FeedEvent,
  item: IngestItem | undefined,
  now: Date,
  result: SourceRunResult,
): Promise<void> {
  if (item && item.contentHash === ev.hash) {
    await db
      .update(ingestItems)
      .set({ lastSeenAt: now, ...reappeared(item) })
      .where(eq(ingestItems.id, item.id))
    return
  }

  // Rejected and detached items never feed an event, so reading their times would only cost LLM calls
  const settled = item !== undefined && (item.status === 'rejected' || item.detachedAt !== null)
  const { extraction, failed } = settled ? { extraction: null, failed: false } : await extractTimes(ev, config)
  // Checked before it is stored: an invalid draft fails the source instead of breaking the inbox later
  const draft = ingestDraftSchema.parse(normalizeFeedEvent(ev, config, extraction))
  const contentHash = failed ? null : ev.hash

  if (!item) {
    await db.insert(ingestItems).values({
      sourceId: source.id,
      externalId: ev.externalId,
      draft,
      raw: ev.raw,
      contentHash,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    result.created++
    return
  }

  await db.transaction(async (tx) => {
    // `item` was read before this run's extractions, so a human edit may have landed since. Lock the
    // event first, then the item: the same order as PUT/DELETE /events/:id (event update, then
    // detachIngest), so the two serialize instead of deadlocking, and the item row read below is current.
    // (An item accepted or linked mid-run can still meet a concurrent edit of its new event in the reverse
    // order; Postgres then aborts one side and this source records the error.)
    if (item.eventId) {
      await tx.select({ id: events.id }).from(events).where(eq(events.id, item.eventId)).for('update')
    }
    const [current] = await tx
      .update(ingestItems)
      .set({ draft, raw: ev.raw, contentHash, lastSeenAt: now, ...reappeared(item) })
      .where(eq(ingestItems.id, item.id))
      .returning()
    // Pending items only get the new draft; rejected and detached ones stay as decided. Without a
    // successful extraction the times are the feed's unverified ones: they wait for the next run.
    if (!failed && current?.status === 'accepted' && current.eventId && !current.detachedAt) {
      if (await syncEvent(tx, source, current.eventId, draft)) result.synced++
    }
  })
  result.updated++
}

async function runSource(source: IngestSource, now: Date, fetchText: (url: string) => Promise<string>): Promise<SourceRunResult> {
  const result: SourceRunResult = { slug: source.slug, ok: false, seen: 0, created: 0, updated: 0, synced: 0, gone: 0 }
  try {
    const config = ingestSourceConfigSchema.parse(source.config)
    const feed = parseIcal(await fetchText(feedUrl(source, now)), config)
    result.seen = feed.length
    const existing = await db.select().from(ingestItems).where(eq(ingestItems.sourceId, source.id))
    // Stored items count too: a first run that crashed before recording its count left no lastItemCount
    if (feed.length === 0 && ((source.lastItemCount ?? 0) > 0 || existing.length > 0)) {
      throw new Error(
        `Feed is empty although the source had events before (last run: ${source.lastItemCount ?? 'none'}, stored items: ${existing.length}); nothing marked gone`,
      )
    }

    const rooms = config.rooms?.map((room) => room.toLowerCase())
    const listed = rooms ? feed.filter((ev) => rooms.includes(ev.locationRoom?.toLowerCase() ?? '')) : feed
    result.seen = listed.length

    const byExternalId = new Map(existing.map((item) => [item.externalId, item]))
    for (const ev of listed) {
      await ingestEvent(source, config, ev, byExternalId.get(ev.externalId), now, result)
    }

    // Items not in the feed (or no longer in a listed room) although they start inside the window it was
    // asked for are gone.
    const { from, to } = runWindow(config, now)
    const startsAt = sql`(${ingestItems.draft}->>'starts_at')::timestamptz`
    const conditions: SQL[] = [
      eq(ingestItems.sourceId, source.id),
      isNull(ingestItems.goneAt),
      sql`${startsAt} >= ${berlinInstant(from, 0).toISOString()}::timestamptz`,
      sql`${startsAt} < ${berlinInstant(nextDay(to), 0).toISOString()}::timestamptz`,
    ]
    if (listed.length > 0) conditions.push(notInArray(ingestItems.externalId, listed.map((ev) => ev.externalId)))
    const gone = await db
      .update(ingestItems)
      .set({ goneAt: now })
      .where(and(...conditions))
      .returning({ id: ingestItems.id })
    result.gone = gone.length

    await db
      .update(ingestSources)
      .set({ lastRunAt: now, lastItemCount: feed.length, lastError: null, updatedAt: now })
      .where(eq(ingestSources.id, source.id))
    result.ok = true
  } catch (err) {
    // Any error, not only FeedParseError: one broken source must not stop the others.
    result.error = err instanceof Error ? err.message : String(err)
    await db
      .update(ingestSources)
      .set({ lastRunAt: now, lastError: result.error, updatedAt: now })
      .where(eq(ingestSources.id, source.id))
  }
  return result
}

/**
 * Fetches every enabled source (or `only`) one after the other into `ingest_items` and syncs accepted events.
 * A run already in progress (cron and CLI share one advisory lock) makes this one return `skipped: true`.
 */
export async function runIngest(opts: RunIngestOptions = {}): Promise<{ skipped: boolean; sources: SourceRunResult[] }> {
  const now = opts.now ?? new Date()
  const fetchText = opts.fetchText ?? fetchFeed

  // A session-level lock needs one connection for lock and unlock, so reserve one from the pool.
  const conn = await db.$client.reserve()
  try {
    const [row] = await conn`select pg_try_advisory_lock(hashtext('ingest')) as locked`
    if (!row?.locked) return { skipped: true, sources: [] }
    try {
      const only = opts.only === undefined ? undefined : [opts.only].flat()
      const sources = await db
        .select()
        .from(ingestSources)
        .where(only ? inArray(ingestSources.slug, only) : eq(ingestSources.enabled, true))
        .orderBy(asc(ingestSources.slug))
      const results: SourceRunResult[] = []
      for (const source of sources) results.push(await runSource(source, now, fetchText))
      return { skipped: false, sources: results }
    } finally {
      await conn`select pg_advisory_unlock(hashtext('ingest'))`
    }
  } finally {
    conn.release()
  }
}

/**
 * The pipeline call the cron endpoint makes, behind a holder so route tests install a stub and never
 * run the real pipeline (which takes the global advisory lock that run.test.ts also uses).
 */
type IngestRunFn = () => Promise<{ skipped: boolean; sources: SourceRunResult[] }>

const defaultRun: IngestRunFn = () => runIngest()
let currentRun: IngestRunFn = defaultRun

export const ingestRunner = {
  run: () => currentRun(),
  setRunner(fn: IngestRunFn) {
    currentRun = fn
  },
  reset() {
    currentRun = defaultRun
  },
}
