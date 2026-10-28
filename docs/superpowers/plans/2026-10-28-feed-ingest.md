# Feed Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Venue iCal feeds (first: ACUD) are fetched daily into a staging table; scouts accept, reject or link new items in a shared `/ingest` inbox; accepted events sync silently until a human edits or claims them.

**Architecture:** New tables `ingest_sources` and `ingest_items` (Drizzle, `packages/db`). Pipeline code in `packages/api/src/ingest/` (adapter → normalize → run). Inbox and duplicate endpoints are Fastify routes under `/api/v1`; the daily run is a Scaleway cron trigger calling `POST /internal/ingest/run`. Web gets an `/ingest` page and a duplicate hint during manual entry.

**Tech Stack:** pnpm monorepo, Fastify 5, Drizzle 0.36 + drizzle-kit, Postgres (`pg_trgm`), Zod, Vitest 2 against the local docker Postgres, Next.js 15, `ical.js` (new dependency).

**Spec:** Uberblick PRD „Feed Ingest: Venue-Feeds mit Review-Inbox“ (`01a183ad-eb0c-71b1-b06b-3ff4c98ab758`, https://uberblick.ai/prd/01a183ad-eb0c-71b1-b06b-3ff4c98ab758) and RFC „Feed Ingest: Datenmodell, Pipeline und Inbox-API“ (`01a183af-2dc2-7f2a-82a2-8b0b1409f3da`, https://uberblick.ai/rfc/01a183af-2dc2-7f2a-82a2-8b0b1409f3da). Read both before starting.

## Global Constraints

- Commits go directly on `main` (project convention); each task ends in one commit with the Co-Authored-By line from the session.
- Nothing from a feed is visible on public endpoints until `accept`. `GET /api/v1/events` must never read `ingest_items`.
- Feed description is taken verbatim (PRD decision), not summarized.
- Image URL lives only in `ingest_items.draft.image_url`; `events` gets no image column (separate PRD „Event-Bilder“).
- Sync never writes through `PUT/DELETE /events/:id` or `POST /events/:id/owners`; those three routes (and CLI `claim-event`) detach.
- Sync edits are logged with `publisherId = source.publisher_id` and `diff.via = 'ingest'` (mirrors the existing `via: 'cli'`).
- Times: feed floating times are interpreted in `config.timezone` (default `Europe/Berlin`); explicit `Z`/TZID times are honoured as given.
- Defaults: `horizon_days = 180`, fetch timeout 20 s, User-Agent `Kellerkompass-Ingest (+https://kellerkompass.de)`, duplicate `likely` threshold `similarity >= 0.4`, max 5 duplicate candidates, form duplicate lookup debounced 500 ms.
- UI copy is English like the rest of the web app: page title "Inbox", tabs "New" / "Gone from source", buttons "Accept", "Reject", "Link to this event", "Cancel event", "Keep", hint "Possible duplicate", badge "Times unverified", edit notice "This event is synced from {source}. Editing it stops the sync."
- All ingest endpoints: scouts only (`publisher.isScout`), otherwise 403 `forbidden`; errors via the existing `ApiError` envelope.

## Review Focus

1. **Feed answers 200 with an HTML error page or garbage** → the source gets `last_error`, no item is marked gone, other sources still run. (Task 7)
2. **Two scouts accept the same item at once** → exactly one event is created, the second request gets 409. (Task 9)
3. **A venue id in `config.venues` no longer exists** → accept falls back to `location_text` instead of failing on the FK. (Task 9)
4. **The same `external_id` appears twice in one feed response** → the run does not crash on the unique index; the later VEVENT wins. (Task 4)
5. **Text extraction reads a different date than the feed** (e.g. "FR 16.10" while `DTSTART` is another day) → the feed date wins, only the times are taken from the text. (Task 5)

---

### Task 1: Data model and migration

**Files:**
- Modify: `packages/db/src/schema.ts` (append after `editHistory`)
- Create: `packages/db/migrations/0003_*.sql` (generated) — then prepend `CREATE EXTENSION IF NOT EXISTS pg_trgm;` by hand
- Test: `packages/api/src/ingest/schema.test.ts`

**Interfaces:**
- Produces (exported from `@open-event-db/db`): tables `ingestSources`, `ingestItems`; enums `ingestSourceKind` (`'ical'`), `ingestItemStatus` (`'pending' | 'accepted' | 'rejected'`); types `IngestSource`, `NewIngestSource`, `IngestItem`, `NewIngestItem`.
- Columns exactly as in the RFC tables. `ingest_sources`: `id uuid pk`, `slug text unique not null`, `name text not null`, `kind`, `url text not null`, `publisherId uuid not null → publishers (restrict)`, `config jsonb not null default {}`, `enabled boolean default true`, `lastRunAt`, `lastError text`, `lastItemCount integer`, `createdAt`, `updatedAt`. `ingest_items`: `id`, `sourceId → ingest_sources (cascade)`, `externalId text not null`, `status default 'pending'`, `draft jsonb not null`, `raw text not null`, `contentHash text` (nullable: null = extraction must be retried), `firstSeenAt`, `lastSeenAt`, `goneAt`, `goneResolvedAt`, `decidedBy → publishers (set null)`, `decidedAt`, `eventId → events (set null)`, `detachedAt`; `uniqueIndex('ingest_items_source_external').on(sourceId, externalId)`, `index('ingest_items_event_idx').on(eventId)`.

- [ ] **Step 1: Write the failing test** — `schema.test.ts` inserts a scout publisher, a source and an item, then inserts a second item with the same `(sourceId, externalId)` and expects the promise to reject; also `SELECT similarity('Burre', 'Burre w/ Heavenphetamine')` returns a number > 0 (proves `pg_trgm`). Clean up in `afterAll`.
- [ ] **Step 2: Run it** — `pnpm db:up && pnpm vitest run packages/api/src/ingest/schema.test.ts` → FAIL (`ingestSources` not exported).
- [ ] **Step 3: Add the tables to `schema.ts`, run `pnpm db:generate`, add the `pg_trgm` line at the top of the generated SQL, run `pnpm db:migrate`.**
- [ ] **Step 4: Run the test** → PASS. Also `pnpm typecheck` → no errors.
- [ ] **Step 5: Commit** — `git add packages/db packages/api/src/ingest/schema.test.ts && git commit -m "Feed ingest: ingest_sources and ingest_items tables"`

### Task 2: Shared ingest schemas

**Files:**
- Create: `packages/shared/src/ingest.ts`, `packages/shared/src/ingest.test.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

**Interfaces:**
- Produces:
  - `ingestSourceConfigSchema` → `{ timezone: string = 'Europe/Berlin', horizon_days: number = 180, external_id_pattern: string | null = null, venues: Record<string, uuid> = {}, extract_from_text: boolean = false, city: string = 'Berlin' }`; type `IngestSourceConfig`.
  - `ingestDraftSchema` → `{ title: string, description: string, starts_at: iso, ends_at: iso | null, venue_id: uuid | null, location_text: string | null, city: string, links: Links, image_url: url | null, source_url: url | null, times_unverified: boolean }`; type `IngestDraft`.
  - `duplicateCandidateSchema` → `{ id, title, starts_at, ends_at, venue_name: string | null, added_by_name: string, similarity: number, likely: boolean }`; type `DuplicateCandidate`.
  - `ingestItemViewSchema` → `{ id, status, source: { slug, name }, draft: IngestDraft, gone_at: iso | null, event_id: uuid | null, duplicates: DuplicateCandidate[] }`; type `IngestItemView`.
  - `ingestListQuerySchema` → `{ view: 'new' | 'gone' = 'new' }`; `ingestRejectSchema` → `{ ids: uuid[] (1–100) }`; `ingestLinkSchema` → `{ event_id: uuid }`; `ingestGoneSchema` → `{ action: 'cancel' | 'keep' }`.
  - `duplicateQuerySchema` → `{ venue_id?: uuid, location_text?: string, starts_at: iso, ends_at?: iso, title?: string, exclude_id?: uuid }`.
  - Add `synced_from: { source_name: string, source_url: string | null } | null` to `eventDetailSchema` in `events.ts`.

- [ ] **Step 1: Write the failing test** — `ingestSourceConfigSchema.parse({})` equals the defaults above; `parse({ external_id_pattern: '(' })` throws (refine: pattern must compile with `new RegExp`); `ingestRejectSchema.parse({ ids: [] })` throws.
- [ ] **Step 2: Run** `pnpm vitest run packages/shared/src/ingest.test.ts` → FAIL.
- [ ] **Step 3: Implement the schemas.** Add `synced_from` to `eventDetailSchema`; make `serializeEventDetail` in `packages/api/src/queries/events.ts` return `synced_from: null` for now so typecheck passes (Task 9 fills it).
- [ ] **Step 4: Run** the test and `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `"Feed ingest: shared Zod schemas"`

### Task 3: Detach on manual edit, cancel and claim

**Files:**
- Create: `packages/api/src/ingest/detach.ts`, `packages/api/src/ingest/detach.test.ts`
- Modify: `packages/api/src/routes/events.ts` (inside the transactions of `PUT /events/:id`, `DELETE /events/:id`, `POST /events/:id/owners`), `packages/db/src/cli.ts` (`claim-event`)

**Interfaces:**
- Consumes: `ingestItems` (Task 1), `DbOrTx` from `packages/api/src/history.ts`.
- Produces: `detachIngest(tx: DbOrTx, eventId: string): Promise<void>` — sets `detachedAt = now()` where `eventId` matches and `detachedAt is null`.

- [ ] **Step 1: Write the failing tests** (`detach.test.ts`, setup like `writes.test.ts`: scout with API key, an unclaimed event created by the scout, an `accepted` item pointing at it):
  - `PUT /api/v1/events/:id` with `{ title: 'Edited' }` → item `detachedAt` not null.
  - Fresh item + `DELETE /api/v1/events/:id` → detached.
  - An item whose event is already detached keeps its original `detachedAt` after another PUT.
- [ ] **Step 2: Run** `pnpm vitest run packages/api/src/ingest/detach.test.ts` → FAIL.
- [ ] **Step 3: Implement `detachIngest` and call it in the three route transactions.** In `cli.ts` `claim-event`, run the same update with `db.update(ingestItems)` directly (the db package cannot import api code).
- [ ] **Step 4: Run** the test file and `packages/api/src/routes/writes.test.ts` → PASS.
- [ ] **Step 5: Commit** — `"Feed ingest: detach synced events on manual edit, cancel and claim"`

### Task 4: iCal adapter

**Files:**
- Create: `packages/api/src/ingest/adapters/ical.ts`, `packages/api/src/ingest/adapters/ical.test.ts`, `packages/api/src/ingest/fixtures/acud.ics`
- Modify: `packages/api/package.json` (add `ical.js`), `packages/api/src/extract/normalize.ts` (export `berlinInstant`, `berlinIso`, `berlinParts`; no behaviour change)

**Interfaces:**
- Consumes: `IngestSourceConfig` (Task 2).
- Produces:
  - `interface FeedEvent { externalId: string; uid: string; summary: string; description: string; start: { date: string /* YYYY-MM-DD in config tz */; time: string | null /* HH:MM */; iso: string }; end: { date: string; time: string | null; iso: string } | null; url: string | null; imageUrl: string | null; locationRoom: string | null; locationText: string | null; raw: string; hash: string }`
  - `parseIcal(text: string, config: IngestSourceConfig): FeedEvent[]` — throws `FeedParseError` when the text is not a VCALENDAR.
  - `class FeedParseError extends Error`.

- [ ] **Step 1: Copy the fixture** — `cp /private/tmp/claude-501/-Users-stian-linger-open-event-db/40202c7a-f0fd-497b-bdc9-add2481a3faf/scratchpad/acud/upcoming.ics packages/api/src/ingest/fixtures/acud.ics` (if missing: `curl -sL "https://acudmachtneu.de/?eme_ical=public&scope=2026-10-28--2027-04-30" -o …` and adjust expected values to its content).
- [ ] **Step 2: Write the failing tests** against the fixture with ACUD config `{ external_id_pattern: '-(\\d+)@' }`:
  - 5 events; the one with summary `Persian Love: SHAB SHOD` has `externalId '2391'`, `start.iso '2026-10-30T22:00:00+01:00'`, `start.time '22:00'`, `locationRoom 'Club'`, `url 'https://acudmachtneu.de/events/persian-love-shab-shod/'`, `imageUrl 'https://acudmachtneu.de/resources/uploads/2026/10/blurred-frame-4.jpg'` (`-150x150` stripped; the page-URL `ATTACH` ignored).
  - `description` keeps line breaks and unescapes `\,`.
  - Hash is stable when only `DTSTAMP` changes and differs when `SUMMARY` changes (string-replace on the fixture).
  - Without `external_id_pattern`, `externalId === uid`.
  - A VEVENT with `DTSTART:20261101T190000Z` → `start.iso '2026-11-01T20:00:00+01:00'` (explicit UTC honoured).
  - `parseIcal('<html>…', cfg)` throws `FeedParseError`.
  - Review Focus 4: a feed containing the same VEVENT twice returns it once (last wins).
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement with `ical.js`.** Treat an empty `TZID=` as floating; convert floating wall time with the now-exported `berlinInstant`/`berlinIso` (Berlin is the only timezone required now; a source with another `timezone` fails with a clear `lastError` until someone needs it). `locationRoom` = first comma segment of `LOCATION`, `locationText` = the whole unescaped value. Hash = sha256 of the VEVENT text with `DTSTAMP` lines removed.
- [ ] **Step 5: Run** → PASS; commit — `"Feed ingest: iCal adapter with ACUD fixture"`

### Task 5: Text extraction and feed normalization

**Files:**
- Modify: `packages/api/src/extract/normalize.ts` (export `normalizeLinks`)
- Modify: `packages/api/src/extract/vision.ts` → move the request/response handling into `callScaleway(config, messages): Promise<Extraction>` and reuse it
- Create: `packages/api/src/extract/text.ts`, `packages/api/src/ingest/normalize.ts`, `packages/api/src/ingest/normalize.test.ts`

**Interfaces:**
- Produces:
  - `interface TextExtractor { extract(text: string): Promise<Extraction> }`, `textExtraction = { extractor, setExtractor(e), reset() }` (same pattern as `vision`; model from `TEXT_MODEL` ?? `VISION_MODEL`; tests always get the `unavailable` stub).
  - Text prompt: reuse `SYSTEM_PROMPT` with the image wording replaced by "the text of an event announcement"; user message is the description text.
  - `normalizeFeedEvent(ev: FeedEvent, config: IngestSourceConfig, extraction: Extraction | null): IngestDraft`.
- Rules (all in the test): title = `ev.summary`; description = `ev.description` with single newlines turned into Markdown hard breaks (`'  \n'`); `links.website = ev.url` plus links from `extraction.links` via the existing link normalization (export `normalizeLinks`); `venue_id = config.venues[ev.locationRoom] ?? null`, else `location_text = ev.locationText`; `city = config.city`; date always from `ev.start.date`; start time = `parseTime(extraction.start_time)` ?? `ev.start.time`; end: if `extraction.end_date` resolves to a later day than the start → multi-day end on that day with `extraction.end_time ?? ev.end.time`; else `extraction.end_time` on the start day, moved to the next day when not after the start; else `ev.end` if after start and within 24 h; else `null`. `times_unverified = extraction === null || extraction.start_time === null`.

- [ ] **Step 1: Write the failing tests** (`normalize.test.ts`, build `FeedEvent`s from the fixture via `parseIcal`):
  - Persian Love + extraction `{ start_time: '22:00', end_time: '04:00' }` → `starts_at '2026-10-30T22:00:00+01:00'`, `ends_at '2026-10-31T04:00:00+01:00'`, `venue_id` = mapped Club id, `times_unverified false`.
  - Psychopomp (feed 15:09) + extraction `{ start_time: '20:00', end_time: null }` → `starts_at '2026-10-31T20:00:00+01:00'`, `ends_at null`.
  - Orbital Decay + extraction `{ start_time: '18:00', end_date: { day: 6, month: 12, year: 2026 } }` → `starts_at '2026-10-01T18:00:00+02:00'`, `ends_at` on 2026-12-06.
  - Any event + `extraction = null` → feed times, `times_unverified true`.
  - Review Focus 5: Burre + extraction `{ date: { day: 17, month: 10 }, start_time: '20:00' }` → `starts_at` still on 2026-10-16.
  - Unmapped room → `venue_id null`, `location_text 'Galerie, 21 Veteranenstrasse, Berlin'` when `config.venues` is empty.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (refactor `vision.ts` without changing its behaviour — `packages/api/src/routes/extract.test.ts` must stay green).
- [ ] **Step 4: Run** `normalize.test.ts` and `extract.test.ts` → PASS.
- [ ] **Step 5: Commit** — `"Feed ingest: text extraction and feed normalization"`

### Task 6: Duplicate matching and `GET /events/duplicates`

**Files:**
- Create: `packages/api/src/queries/duplicates.ts`, `packages/api/src/queries/duplicates.test.ts`
- Modify: `packages/api/src/routes/events.ts` (register `GET /events/duplicates` **before** `GET /events/:id`)

**Interfaces:**
- Produces: `findDuplicateCandidates(input: { venueId?: string | null; locationText?: string | null; startsAt: Date; endsAt?: Date | null; title?: string | null; excludeId?: string | null }, limit = 5): Promise<DuplicateCandidate[]>`.
- Window: Berlin calendar day of `startsAt` (00:00–24:00) or `[startsAt, endsAt]` when the input spans more than a day; an event matches when its `[starts_at, coalesce(ends_at, starts_at)]` overlaps the window. Place: `venue_id = input.venueId`, or (input has a venue) `events.location_text ILIKE '%' || venue.name || '%'`, or (input has only `locationText`) `events.location_text ILIKE input` or the event's venue name occurs in `input.locationText`. Excludes `status = 'cancelled'` and `excludeId`. Order: `similarity(title, input.title) desc, starts_at`.

- [ ] **Step 1: Write the failing tests:** same venue + same day → found with `likely true` for a near-identical title; same venue, next day → not found; cancelled → not found; event with `location_text 'ACUD Club, Veteranenstr.'` and input with that venue → found; two candidates ordered by similarity; route `GET /api/v1/events/duplicates?venue_id=…&starts_at=…` returns `{ data: [...] }` without auth; missing `starts_at` → 400.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (Drizzle `sql` for `similarity` and the overlap condition).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `"Duplicate matching and GET /events/duplicates"`

### Task 7: Ingest run pipeline

**Files:**
- Create: `packages/api/src/ingest/run.ts`, `packages/api/src/ingest/run.test.ts`

**Interfaces:**
- Consumes: `parseIcal`, `FeedParseError` (Task 4), `normalizeFeedEvent`, `textExtraction` (Task 5), `logEdit`/`diff` (`history.ts`), `eventSnapshot` (`queries/events.ts`).
- Produces:
  - `interface SourceRunResult { slug: string; ok: boolean; error?: string; seen: number; created: number; updated: number; synced: number; gone: number }`
  - `runIngest(opts?: { only?: string; now?: Date; fetchText?: (url: string) => Promise<string> }): Promise<{ skipped: boolean; sources: SourceRunResult[] }>` — default `fetchText` uses `fetch` with 20 s timeout and the User-Agent from Global Constraints; non-2xx throws.
  - `feedUrl(source: IngestSource, now: Date): string` — replaces `{from}` with today and `{to}` with today + `horizon_days` (Berlin dates, `YYYY-MM-DD`).
- Behaviour: `pg_try_advisory_lock(hashtext('ingest'))` or return `{ skipped: true }`; enabled sources (or `only`) sequentially; per source try/catch → `lastError`; per `FeedEvent` the RFC rules (unchanged hash → `lastSeenAt` only; extraction only when `config.extract_from_text`, failure → `contentHash = null`; status handling; sync updates `title, description, startsAt, endsAt, venueId, locationText, links.website` and logs `diff: { ...diff(before, after), via: 'ingest' }`); after the loop gone-marking for unseen items with `draft.starts_at` in the window, reappearing items get `goneAt = null`; empty-feed guard; set `lastRunAt`, `lastItemCount`, clear `lastError` on success.

- [ ] **Step 1: Write the failing tests** (DB; source with ACUD config; `fetchText` returns the fixture or a variant; `textExtraction.setExtractor` stub returning fixed times):
  - First run → 5 `pending` items, `created 5`.
  - Second identical run → `created 0, updated 0`, `lastSeenAt` advanced, stub called 0 times the second run.
  - Reject one, change its SUMMARY in the fixture, run → still `rejected`, `draft.title` updated, no event created.
  - Accepted item (event inserted by hand in the test, `eventId` set) + changed DTSTART → event `startsAt` changed, `edit_history` row with `diff.via === 'ingest'`.
  - Same with `detachedAt` set → event unchanged.
  - Feed without one accepted item → that item gets `goneAt`; feed with it again → `goneAt null`.
  - Review Focus 1: `fetchText` resolves `'<html>error</html>'` → result `ok false`, `lastError` set, no `goneAt` anywhere; a second source in the same run still processes.
  - Empty VCALENDAR after a run with 5 items → no `goneAt`, `lastError` mentions the empty feed.
  - Extractor throws → item stored with `times_unverified true` and `contentHash null`; next run calls the extractor again.
  - Two concurrent `runIngest()` calls → one returns `skipped: true`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `"Feed ingest: run pipeline with sync, gone marking and empty-feed guard"`

### Task 8: CLI and internal run endpoint

**Files:**
- Modify: `packages/db/src/cli.ts` (usage + commands), `packages/api/package.json` (script `"ingest": "tsx --env-file-if-exists=../../.env src/ingest/cli.ts"`)
- Create: `packages/api/src/ingest/cli.ts`, `packages/api/src/routes/internal.ts`, `packages/api/src/routes/internal.test.ts`
- Modify: `packages/api/src/app.ts` (register `internalRoutes` outside the `/api/v1` prefix)

**Interfaces:**
- Consumes: `runIngest` (Task 7), `ingestSourceConfigSchema` (Task 2).
- Produces:
  - `pnpm db:cli ingest-add-source <slug> <name> <url> <scout_slug> [--config '<json>']` (validates config with the Zod schema — import from `@open-event-db/shared`, add it to `packages/db` dependencies — and that the publisher is a scout), `pnpm db:cli ingest-list` (slug, enabled, last run, last error, item counts per status), `pnpm db:cli ingest-disable <slug>`, `pnpm db:cli ingest-enable <slug>`.
  - `pnpm --filter @open-event-db/api ingest [slug]` → prints the `runIngest` result as JSON.
  - `POST /internal/ingest/run`: 404 when `INGEST_CRON_SECRET` is empty; 403 when `X-Ingest-Secret` mismatches (timing-safe compare as in the magic-link endpoint); 200 `{ data: runIngest() }` otherwise. Exempt from the global rate limit via the existing `allowList`.

- [ ] **Step 1: Write the failing tests** (`internal.test.ts`): unset secret → 404; wrong secret → 403; right secret → 200 and the body has `data.sources` (use a source-less DB state or `only` a non-existent slug to keep it fast).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement route, CLI commands and script.**
- [ ] **Step 4: Run** the tests → PASS. Manual check: `pnpm db:cli ingest-add-source test-acud "ACUD macht neu" "https://acudmachtneu.de/?eme_ical=public&scope={from}--{to}" <local scout slug> --config '{"external_id_pattern":"-(\\d+)@"}'` then `pnpm --filter @open-event-db/api ingest test-acud` prints `created` > 0 against the local DB; `pnpm db:cli ingest-list` shows it.
- [ ] **Step 5: Commit** — `"Feed ingest: CLI and cron-triggered run endpoint"`

### Task 9: Inbox API and `synced_from`

**Files:**
- Create: `packages/api/src/routes/ingest.ts`, `packages/api/src/routes/ingest.test.ts`
- Modify: `packages/api/src/app.ts` (register under `/api/v1`), `packages/api/src/queries/events.ts` (`synced_from`)

**Interfaces:**
- Consumes: Task 2 schemas, `findDuplicateCandidates` (Task 6), `detachIngest` (Task 3), event insert pattern from `POST /events` (`logEdit` `created`), cancel logic from `DELETE /events/:id`.
- Produces the endpoints in the RFC table; list response `{ data: IngestItemView[], meta: { counts: { new: number, gone: number } } }`; `GET /ingest/count` → `{ data: { new, gone } }` for the header badge.
- `accept`: `UPDATE … SET status='accepted', decided_by, decided_at WHERE id=$1 AND status='pending' RETURNING` inside the transaction — no row → 409 `conflict`. Then insert the event from `draft` (`createdBy = source.publisherId`, no owner row); if `draft.venue_id` no longer exists, insert with `venueId null` and `locationText = draft.location_text ?? source.name`; set `eventId`. Response `{ data: { event_id } }`.
- `link`: target event must exist (404 otherwise); sets `eventId`, `detachedAt`, `status 'accepted'`.
- `gone`: `cancel` → event `status 'cancelled'` + `logEdit cancelled` + `detachIngest`; `keep` → `goneResolvedAt = now()`.
- `synced_from`: in `getEventDetail`, left-join the item (`eventId = id and detachedAt is null`) and its source → `{ source_name: source.name, source_url: draft.source_url }`.

- [ ] **Step 1: Write the failing tests:** non-scout publisher → 403 on every endpoint; list `view=new` returns pending items sorted by `draft.starts_at` with `duplicates` filled when a matching event exists, and `meta.counts`; accept → event exists, `added_by` is the source's scout, `claimed false`, item `accepted`; second accept → 409; Review Focus 2: two accepts via `Promise.all` → one 200, one 409, one event; Review Focus 3: accept with a deleted venue id → 200, event has `location_text`; reject with two ids → both `rejected`, `view=new` no longer lists them; link → item accepted and detached, linked event unchanged; `view=gone` lists an accepted item with `goneAt`; `gone` `keep` removes it from the list; `gone` `cancel` → event cancelled; `GET /events/:id` for an accepted, non-detached event has `synced_from.source_name`, after a PUT it is `null`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** this file plus `writes.test.ts` → PASS.
- [ ] **Step 5: Commit** — `"Feed ingest: scout inbox API and synced_from on event detail"`

### Task 10: Inbox page in the web app

**Files:**
- Create: `packages/web/src/app/ingest/page.tsx`, `packages/web/src/components/IngestInbox.tsx`, `packages/web/src/components/IngestItemCard.tsx`
- Modify: `packages/web/src/components/Header.tsx` (scouts: `NavLink href="/ingest"` "Inbox" with count from `GET /ingest/count`), `packages/web/src/lib/api.ts` (`getIngestItems(view, cookie)`, `getIngestCount(cookie)` — forward the session cookie like `getMe`)

**Interfaces:**
- Consumes: Task 9 endpoints and `IngestItemView`.
- Page: server component; not a scout → `notFound()`. Tabs via `?view=new|gone`. Client component handles actions with `fetch(..., { credentials: 'include' })` and `router.refresh()`; after accept a toast "Accepted — Open event" linking to `/events/{event_id}` (reuse `Toast`). Card: thumbnail from `draft.image_url` (plain `<img loading="lazy">`, no Next image optimisation for remote hosts), title, Berlin date/time via `lib/format.ts`, venue/location, source badge, "Times unverified" badge, collapsible description (`Markdown` component), link "Original" to `draft.source_url`, checkbox for bulk reject, "Possible duplicate" box listing candidates with "Link to this event". Empty state: "Nothing new."

- [ ] **Step 1: Seed local data** — run Task 8's manual commands so the inbox has items; create a duplicate by hand for one of them.
- [ ] **Step 2: Implement the page and components.**
- [ ] **Step 3: Verify in the browser** — `preview_start` the web and API dev servers, log in as the local scout, open `/ingest`: items listed with times, duplicate box shown for the seeded duplicate, Accept → toast + event page shows "Added by … · Scout", Reject (bulk, two items) → gone from the list, "Gone from source" tab empty; log in as a non-scout → `/ingest` is 404 and the header has no Inbox link. Screenshot for the user. `pnpm typecheck` passes.
- [ ] **Step 4: Commit** — `"Feed ingest: scout inbox page"`

### Task 11: Duplicate hint during manual entry and sync notice on edit

**Files:**
- Modify: `packages/web/src/components/EventForm.tsx` (new optional prop `onDraftChange?: (d: { venueId: string | null; locationText: string | null; startsAt: string | null; endsAt: string | null; title: string }) => void`, called from the existing field state in create mode), `packages/web/src/components/NewEventForm.tsx` (replace `findPossibleDuplicates` with a call to `/api/v1/events/duplicates`, triggered both after import and from `onDraftChange`, debounced 500 ms, show "likely" candidates first), `packages/web/src/app/events/[id]/edit/page.tsx` (notice when `event.synced_from` is set)
- Test: `packages/web/src/lib/duplicates.test.ts` with `Create: packages/web/src/lib/duplicates.ts` → `duplicateQuery(d): URLSearchParams | null` (null until a start and a venue or location text exist)

- [ ] **Step 1: Write the failing test** for `duplicateQuery`: no start → null; start + venue → params with `venue_id`, `starts_at`, `title`; start + only location text → `location_text` param.
- [ ] **Step 2: Run** `pnpm vitest run packages/web/src/lib/duplicates.test.ts` → FAIL; implement; → PASS.
- [ ] **Step 3: Wire the form and the edit notice.**
- [ ] **Step 4: Verify in the browser** — on `/events/new` type a title, pick the venue and date of an existing event: the "This event may already exist" box appears without any import; the edit page of an accepted ingest event shows the sync notice; after saving, the notice is gone. Screenshot.
- [ ] **Step 5: Commit** — `"Duplicate hint during manual entry, sync notice on edit"`

### Task 12: Production rollout and docs

**Files:**
- Modify: `DEPLOY.md` (env `INGEST_CRON_SECRET`, optional `TEXT_MODEL`; Scaleway cron trigger on the API container: schedule `0 4 * * *` (Scaleway cron triggers run in UTC: 05:00 Berlin in winter, 06:00 in summer), HTTP POST to `/internal/ingest/run` with header `X-Ingest-Secret`), Uberblick Developer Reference pages listed under Page Impact in PRD and RFC.

- [ ] **Step 1: Update `DEPLOY.md`; commit** — `"Deploy notes for feed ingest cron"`.
- [ ] **Step 2: Ask the user before touching production**, then via `scripts/prod-db.sh`: run migrations, `create-publisher "Kellerkompass Import" kellerkompass-import <email> --scout`, create or find venues "ACUD Club", "ACUD Galerie", "ACUD Studio" (Veteranenstraße 21, 10119 Berlin), `ingest-add-source acud "ACUD macht neu" "https://acudmachtneu.de/?eme_ical=public&scope={from}--{to}" kellerkompass-import --config '{"external_id_pattern":"-(\\d+)@","extract_from_text":true,"venues":{"Club":"…","Galerie":"…","Studio":"…"}}'`.
- [ ] **Step 3: Deploy, set the secret, create the cron trigger, trigger one run by hand** (`curl -X POST -H "X-Ingest-Secret: …" https://api.kellerkompass.de/internal/ingest/run`) and check `/ingest` on production lists ACUD's upcoming events with plausible times.
- [ ] **Step 4: Update the Uberblick Developer Reference pages** (Data Model, REST API, Architecture, Web App & Design System, Event Capture) and tick Page Impact in PRD and RFC. Note in the RFC that the description comes from `DESCRIPTION` (plain text with Markdown hard breaks), not `X-ALT-DESC`.
