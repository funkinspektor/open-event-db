# LLM Fit Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every open pending inbox item gets an LLM verdict (`fit` / `maybe` / `no`) with a one-line reason. "New" lists fits first, clear misfits move to a "Filtered out" tab, and the inbox shows per source how often the verdicts matched the scouts' decisions. Nothing is published or rejected automatically.

**Architecture:**
- Five new columns on `ingest_items`.
- A scoring pass in `packages/api/src/ingest/fit/` that runs at the end of `runIngest`, inside the same advisory lock, and also from a CLI. It uses a swappable scorer holder: Scaleway in production, stubs in tests.
- The inbox API gains a `filtered` view, a rank-aware keyset cursor and a `GET /ingest/accuracy` endpoint.
- The web inbox gains a tab, card labels and an accuracy block.

**Tech Stack:** pnpm monorepo, Fastify 5, Drizzle + drizzle-kit, Postgres, Zod, Vitest 2 against the local docker Postgres, Next.js 15, Scaleway Generative APIs (OpenAI-compatible chat completions).

**Spec:** `docs/superpowers/specs/2026-10-30-llm-fit-scoring-design.md`. Read it before starting.

## Global Constraints

**Branch and commits**
- Work on branch `llm-fit-scoring` in the worktree `.claude/worktrees/llm-fit-scoring`.
- Each task ends in one commit whose message ends with the session's Co-Authored-By line. Do not push and do not merge into main; the user fast-forwards.

**Model and cost**
- Shadow mode: no code path publishes, accepts or rejects an item based on a verdict.
- The model comes from the existing Scaleway env vars: `SCALEWAY_SECRET_KEY`, `SCALEWAY_PROJECT_ID`, `TEXT_MODEL || VISION_MODEL` (an empty `TEXT_MODEL` counts as unset). Under `isTestRun` the default scorer is `null`, so tests never call the provider.
- Limits: at most 200 items per pass; 4 calls at a time; soonest start first. Examples: 20 accepted and 20 rejected. Description cut to 1,500 characters for the item and 150 characters per example. Reasons are cut to 200 characters. Accuracy window: 60 days.

**Errors**
- Any error in the scoring pass is caught and logged. It never fails `runIngest`, never changes a `SourceRunResult`, and never changes the CLI exit code of `pnpm ingest`.
- A failed call writes nothing to the item. A new item stays unscored; a re-scored item keeps its previous verdict and fingerprint, so it is retried.

**Tests and copy**
- Tests share one database with other test files running in parallel. Every scoring test passes `only: [<its own source slug>]` and asserts only on its own items.
- UI copy is English:
  - Tab: "Filtered out". Empty state: "Nothing filtered out."
  - Labels: "Fits", "Maybe", "Doesn't fit".
  - Block heading "Accuracy", columns "Source", "Fits accepted", "Doesn't fit rejected", "Rescued".
  - Empty block: "No decisions on scored items in the last 60 days."
- The taste description lives in `packages/api/src/ingest/fit/taste.ts` as an exported string, not as `taste.md`. The production build bundles with esbuild, so a runtime file read would miss the file. It is still a plain text constant edited by commit, as the spec intends.

## Review Focus

1. **A scout decides an item while its scoring call is in flight.** The later write must not touch the decided item: it is guarded by `status = 'pending'`. (Task 3)
2. **A pending item has a broken stored draft.** The pass skips it with a warning and scores the rest. (Task 3)
3. **A page of "New" ends exactly at the boundary between fits and maybes.** The next page starts with the first maybe, with no item skipped or repeated. (Task 5)
4. **A scout opens a "Next 50" link saved before the deploy** (cursor without `rank`). The list starts from the top instead of erroring. (Task 5)
5. **A bulk reject includes an item with a broken draft.** The reject still succeeds for all items, and that item gets `had_duplicates = false`. (Task 4)

---

### Task 1: Fit columns on `ingest_items`

**Files:**
- Modify: `packages/db/src/schema.ts` (new enum next to `ingestItemStatus`; columns at the end of `ingestItems`)
- Create: `packages/db/migrations/0012_*.sql` (generated)
- Modify: `packages/shared/src/ingest.ts` (verdict enum schema)
- Test: `packages/api/src/ingest/schema.test.ts`

**Interfaces:**
- Produces from `@open-event-db/db`:
  - `ingestFitVerdict = pgEnum('ingest_fit_verdict', ['fit', 'maybe', 'no'])`.
  - On `ingestItems`: `fitVerdict` (`fit_verdict`, nullable), `fitReason` (`fit_reason` text, nullable), `fitScoredAt` (`fit_scored_at` timestamptz, nullable), `fitFingerprint` (`fit_fingerprint` text, nullable), `hadDuplicates` (`had_duplicates` boolean, not null, default false).
- Produces from `@open-event-db/shared`: `ingestFitVerdictSchema = z.enum(['fit', 'maybe', 'no'])` and `type IngestFitVerdict`.

- [ ] **Step 1: Write the failing test.** In `schema.test.ts`, add `it('stores a fit verdict and defaults had_duplicates to false')`:
  - insert an item without fit fields; expect `hadDuplicates === false` and `fitVerdict === null`;
  - update it to `{ fitVerdict: 'no', fitReason: 'Indie night', fitScoredAt: new Date(), fitFingerprint: 'x' }` and read it back equal;
  - expect an update with `fitVerdict: 'nope' as never` to reject.
- [ ] **Step 2: Run it.** `pnpm db:up && pnpm vitest run packages/api/src/ingest/schema.test.ts` → FAIL (`fitVerdict` unknown).
- [ ] **Step 3: Add the enum and columns.** Then run `pnpm db:generate` (expect one new `0012_*.sql` with `CREATE TYPE ... ingest_fit_verdict` and five `ADD COLUMN`s) and `pnpm db:migrate`. Add `ingestFitVerdictSchema` to `packages/shared/src/ingest.ts`.
- [ ] **Step 4: Verify.** Run the test → PASS. `pnpm typecheck` → no errors.
- [ ] **Step 5: Commit.** `git add packages/db packages/shared/src/ingest.ts packages/api/src/ingest/schema.test.ts && git commit -m "Fit scoring: verdict columns on ingest items"`

### Task 2: Prompt, fingerprint and scorer

**Files:**
- Modify: `packages/api/src/extract/vision.ts`. Split `callScaleway` into a generic JSON call plus the existing wrapper.
- Create: `packages/api/src/ingest/fit/taste.ts`, `packages/api/src/ingest/fit/prompt.ts`, `packages/api/src/ingest/fit/scorer.ts`
- Test: `packages/api/src/ingest/fit/prompt.test.ts`, `packages/api/src/ingest/fit/scorer.test.ts`

**Interfaces:**
- `vision.ts` produces:
  - `callScalewayJson<T>(config: ScalewayConfig, messages: ChatMessage[], opts: { label: string; schemaName: string; jsonSchema: object; parse: z.ZodType<T>; maxTokens?: number }): Promise<T>`.
  - It contains today's fetch, timeout, fence-stripping and error logic unchanged. It throws `ExtractionError` with the same kinds: `timeout`, `provider`, `invalid_output`.
  - `callScaleway(config, messages, label)` keeps its signature and becomes a thin wrapper with `schemaName: 'event_extraction'`, `EXTRACTION_JSON_SCHEMA`, `extractionSchema` and `maxTokens: 2000`.
- `taste.ts` produces `TASTE: string`, holding the description from the spec, section 2.
- `prompt.ts` produces:
  - `FIT_SYSTEM_PROMPT: string`
  - `PROMPT_VERSION: string`: the first 16 hex characters of `sha256(FIT_SYSTEM_PROMPT)`. `FIT_SYSTEM_PROMPT` embeds `TASTE`, so editing either changes the version.
  - `interface FitSubject { title: string; place: string | null; source: string; starts_at: string; categories: string[]; description: string }`
  - `subjectOf(draft: IngestDraft, venueName: string | null, sourceName: string): FitSubject`
    - `place = venueName ?? draft.location_text`.
    - `description` is whitespace-collapsed and cut to 1,500 characters.
  - `fingerprint(subject: FitSubject): string`: sha256 hex of `PROMPT_VERSION + '\n' + JSON.stringify(subject)`, keys in the interface order above.
  - `interface FitExamples { accepted: FitSubject[]; rejected: FitSubject[] }`
  - `buildPrompt(subject: FitSubject, examples: FitExamples): { system: string; user: string }`
    - `system` = `FIT_SYSTEM_PROMPT`, then the example lists.
    - Each example is one line: `- {title} | {place ?? 'unknown place'} | {description cut to 150}`.
    - The lists are headed "Recently accepted by the editors:" and "Recently rejected by the editors:". A list with no examples is omitted.
    - `user` holds the subject's fields as `Label: value` lines.
- `scorer.ts` produces:
  - `fitJudgementSchema = z.object({ verdict: ingestFitVerdictSchema, reason: z.string().transform((s) => s.trim().slice(0, 200)) })`
  - `type FitJudgement`
  - `interface FitScorer { score(prompt: { system: string; user: string }): Promise<FitJudgement> }`
  - `scalewayFit(config: ScalewayConfig): FitScorer`: label `'Fit'`, schema name `'fit_judgement'`, `maxTokens: 200`.
  - `fitScoring = { get scorer(): FitScorer | null; setScorer(s: FitScorer | null): void; reset(): void }`. The default is built from env as in `extract/text.ts`; it is `null` when unconfigured or under `isTestRun`.

`FIT_SYSTEM_PROMPT` copy:

```text
You help the editors of Kellerkompass, a curated event guide for one subculture, decide which events from venue feeds belong in the guide.

What belongs:
${TASTE}

Judge ONE event and answer with JSON {"verdict": ..., "reason": ...}:
- "fit": clearly part of this scene.
- "maybe": unsure, or the information is not enough to judge.
- "no": clearly outside this scene.
When in doubt, answer "maybe": wrongly filtering out a scene event costs more than one extra event to review.
"reason" is one short English sentence (at most 140 characters) naming what decided it, e.g. the genre or the kind of event.
The editors' recent decisions follow as examples of their taste; weigh them, but the description above comes first.
```

- [ ] **Step 1: Write the failing tests.** In `prompt.test.ts`:
  - `subjectOf` cuts a 3,000-character description to 1,500, and uses the venue name over `location_text`.
  - `fingerprint` changes when the title changes, and is identical for two equal subjects.
  - `buildPrompt(subject, { accepted: [a], rejected: [] })`: `system` contains `a.title`, contains "Recently accepted by the editors:", and does not contain "Recently rejected".
  - `buildPrompt` never changes `fingerprint(subject)`. This is trivially pure; the assertion documents the spec rule.
  - Review Focus #2 input: a subject with an empty description builds a prompt without throwing.

  In `scorer.test.ts`:
  - `fitJudgementSchema.parse({ verdict: 'maybe', reason: 'x'.repeat(300) }).reason.length === 200`.
  - Parsing `{ verdict: 'unsure', reason: 'x' }` throws.
  - `fitScoring.scorer === null` under Vitest.
- [ ] **Step 2: Run them.** `pnpm vitest run packages/api/src/ingest/fit` → FAIL (modules missing).
- [ ] **Step 3: Implement** `callScalewayJson`, `taste.ts`, `prompt.ts` and `scorer.ts` as specified.
- [ ] **Step 4: Verify.**
  - `pnpm vitest run packages/api/src/ingest/fit packages/api/src/extract` → PASS. The extract tests prove the refactor kept extraction working.
  - `pnpm typecheck` → clean.
- [ ] **Step 5: Commit.** `git commit -m "Fit scoring: prompt, fingerprint and Scaleway scorer"`

### Task 3: The scoring pass, run integration and CLI

**Files:**
- Create: `packages/api/src/ingest/open.ts`. Move `draftStartsAt`, `draftEndsAt`, `startOfToday`, `notOver` out of `routes/ingest.ts`, and add `isOpen`.
- Modify: `packages/api/src/routes/ingest.ts` (import from `open.ts`; no behaviour change in this task)
- Create: `packages/api/src/ingest/fit/score.ts`, `packages/api/src/ingest/score-cli.ts`
- Modify: `packages/api/src/ingest/run.ts`, `packages/api/package.json`
- Test: `packages/api/src/ingest/fit/score.test.ts`, `packages/api/src/ingest/run.test.ts`

**Interfaces:**
- Consumes from Task 2: `fitScoring`, `subjectOf`, `fingerprint`, `buildPrompt`, `FitExamples`.
- `open.ts` produces:
  - `draftStartsAt`, `draftEndsAt`, `notOver()`, exactly as now.
  - `isOpen(): SQL`: `status = 'pending' and gone_at is null and notOver()`. This is today's `isNew()`.
- `score.ts` produces:
  - `interface ScoreOptions { only?: string[]; limit?: number; concurrency?: number }`. `only` holds source slugs; defaults are 200 and 4.
  - `interface ScoreResult { skipped?: 'no model'; scored: number; fit: number; maybe: number; no: number; failed: number }`
  - `selectExamples(opts?: { only?: string[] }): Promise<FitExamples>`
    - Accepted: `status = 'accepted'`, ordered by `decided_at desc`, limit 20.
    - Rejected: `status = 'rejected' and not had_duplicates`, same order and limit.
    - Venue and source names come from joins. Broken drafts are skipped.
    - `only` exists so tests stay isolated; production passes nothing.
  - `scorePending(opts?: ScoreOptions): Promise<ScoreResult>`. With `fitScoring.scorer === null` it returns `{ skipped: 'no model', scored: 0, fit: 0, maybe: 0, no: 0, failed: 0 }`.
    - **Selection:** load every `isOpen()` item, joined to venue and source names. Skip and `console.warn` broken drafts. Compute each subject's fingerprint and keep items whose `fitFingerprint` differs. Sort by `starts_at` ascending and take `limit`.
    - **Scoring:** call `selectExamples` once, then score with at most `concurrency` calls in flight.
    - **Writing:** on success, set `fitVerdict`, `fitReason`, `fitScoredAt = now`, `fitFingerprint` `where id = ? and status = 'pending'`.
    - **Failures:** `console.warn({ itemId, err })` and count it in `failed`; write nothing.
  - `withIngestLock<T>(fn: () => Promise<T>): Promise<T | null>`, moved out of `runIngest`'s body into `run.ts` and exported. It returns `null` when another run holds the lock.
- `run.ts`:
  - `runIngest`'s return type gains `scoring?: ScoreResult | { error: string }`.
  - After the source loop, still inside the lock, it calls `scorePending({ only: opts.only ? [opts.only].flat() : undefined })` wrapped in try/catch.
  - A skipped run (lock held) has no `scoring`.
- `score-cli.ts`: `pnpm --filter @open-event-db/api ingest:score [--limit N] [slug ...]`. It runs `withIngestLock(() => scorePending(...))`, prints the result JSON, and exits 1 only when the lock was held. Add the script `"ingest:score": "tsx --env-file-if-exists=../../.env src/ingest/score-cli.ts"`.

- [ ] **Step 1: Write the failing tests** in `score.test.ts`. Use your own scout, a source `fit-${stamp}`, and a stub scorer installed with `fitScoring.setScorer(stub)`; reset in `afterEach`. The stub returns `fit` when `user` contains "Wave", `no` when it contains "Indie", and `maybe` otherwise. It records every call.
  - `scores new items and skips decided, gone, past and current ones`:
    - Items: a pending "Wave night", a pending "Indie night", an accepted item, a rejected item, a gone pending item, a pending item that ended yesterday, and a pending item whose `fitFingerprint` already equals `fingerprint(subjectOf(...))`.
    - Expect `{ scored: 2, fit: 1, no: 1, failed: 0 }`, the verdicts and reasons stored, and exactly 2 stub calls.
  - `re-scores an item whose draft changed`: score once, change the stored draft title, score again → one call, new verdict.
  - `leaves the item untouched when the call fails`:
    - The stub throws for one item → `failed: 1`, and that item keeps `fitVerdict === null`.
    - A second pass with a working stub scores it.
  - `skips an item with a broken draft and scores the rest` (Review Focus #2).
  - `does not overwrite an item decided while scoring` (Review Focus #1): the stub, before resolving, sets the item to `rejected` → the item's `fitVerdict` stays null.
  - `caps a pass at the limit, soonest first`: 3 items, `limit: 2` → the two earliest are scored.
  - `selectExamples drops rejects with duplicates and counts linked items as accepted`:
    - Items: accepted, accepted with `eventId` (linked), rejected, and rejected with `hadDuplicates: true`.
    - With `only` → 2 accepted and 1 rejected; the duplicate reject is absent.
  - `passes the examples to the scorer`: after one accepted "Cold Wave Club" item, the stub's `system` contains "Cold Wave Club".
  - `reports a skipped pass without a model`: `setScorer(null)` → `skipped: 'no model'`.

  In `run.test.ts`, add `a scoring failure does not fail the run`:
  - Install a scorer that always throws.
  - Run `runIngest({ only: <its source>, fetchText })` with a fixture feed whose events lie in the future, so its items are open.
  - Expect every source result `ok: true` and `scoring.failed ≥ 1`.
- [ ] **Step 2: Run them.** `pnpm vitest run packages/api/src/ingest` → FAIL.
- [ ] **Step 3: Implement** `open.ts` and the import switch in `routes/ingest.ts`, then `score.ts`, the `run.ts` changes, `score-cli.ts` and the script.
- [ ] **Step 4: Verify.** `pnpm vitest run packages/api` → PASS. `pnpm typecheck` → clean.
- [ ] **Step 5: Commit.** `git commit -m "Fit scoring: scoring pass after each ingest run, ingest:score CLI"`

### Task 4: Reject records duplicates

**Files:**
- Modify: `packages/api/src/routes/ingest.ts` (`POST /ingest/items/reject`)
- Test: `packages/api/src/routes/ingest.test.ts`

**Interfaces:**
- No API shape change; the response stays `{ data: { rejected: number } }`.
- Behaviour:
  - Load the pending items among `ids`.
  - For each item with a valid draft, run `findDuplicateCandidates` with the same input as `toView`.
  - Update with `status: 'rejected', decidedBy, decidedAt` and `hadDuplicates: candidates.length > 0`, still `where status = 'pending'`.
  - An item with a broken draft gets `hadDuplicates: false`.

- [ ] **Step 1: Write the failing tests.**
  - `reject marks items that had duplicate candidates`:
    - Create an event at the scout venue at the draft's start with a similar title, plus an item matching it and an item without any match.
    - Reject both in one call → `hadDuplicates` is true for the first and false for the second.
  - `reject still rejects an item with a broken draft` (Review Focus #5): the stored draft has no `title` → `rejected: 1` and `hadDuplicates === false`.
- [ ] **Step 2: Run them.** `pnpm vitest run packages/api/src/routes/ingest.test.ts -t reject` → FAIL.
- [ ] **Step 3: Implement** in the reject route.
- [ ] **Step 4: Verify.** Run the file → PASS.
- [ ] **Step 5: Commit.** `git commit -m "Inbox: a reject records whether duplicates were shown"`

### Task 5: Filtered view, fits-first order and verdict in the item view

**Files:**
- Modify: `packages/shared/src/ingest.ts`, `packages/shared/src/ingest.test.ts`
- Modify: `packages/api/src/routes/ingest.ts`
- Test: `packages/api/src/routes/ingest.test.ts`

**Interfaces:**
- Shared:
  - `ingestListQuerySchema.view` becomes `z.enum(['new', 'filtered', 'gone']).default('new')`, and `type IngestView` is exported.
  - `ingestItemViewSchema` gains `fit: z.object({ verdict: ingestFitVerdictSchema, reason: z.string() }).nullable()`.
- API:
  - `isNew() = and(isOpen(), or(isNull(fitVerdict), ne(fitVerdict, 'no')))` and `isFiltered() = and(isOpen(), eq(fitVerdict, 'no'))`.
  - `getItem` judges state `'new'` with `isOpen()`, so a filtered item's detail page keeps its actions.
  - `counts(source?)` returns `{ new, filtered, gone }`. `GET /ingest/count` returns the same object; the header keeps summing only `new` and `gone`.
  - `sourceCounts(view)` handles `'filtered'`.
  - `toView` fills `fit` (null unless both verdict and reason are set) and looks up duplicates for `new` and `filtered`.
- Order and cursor:
  - Rank expression: `case fit_verdict when 'fit' then 0 when 'maybe' then 1 else 2 end` for `new`, constant `0` for the other views.
  - Order: `rank, draftStartsAt, id`.
  - `itemCursorSchema` gains `rank: z.number().int().min(0).max(2)` (required). The keyset condition becomes `(rank, starts_at, id) > (…)`, and the cursor is encoded from the last row's rank.

- [ ] **Step 1: Write the failing tests.**
  - Shared: `ingestListQuerySchema.parse({ view: 'filtered' }).view === 'filtered'`.
  - API test `sorts fits first and moves misfits to the filtered view`, on its own source:
    - Items:
      - `maybe` starting day 1,
      - `fit` starting day 3,
      - unscored starting day 2,
      - `no` starting day 1,
      - `fit` starting day 2.
    - `new` lists `[fit d2, fit d3, maybe d1, unscored d2]`.
    - `filtered` lists `[no d1]`, with `fit: { verdict: 'no', reason }`.
    - `meta.counts` equals `{ new: 4, filtered: 1, gone: 0 }`.
    - The "no" item's `GET /ingest/items/:id` has `state: 'new'`.
  - API test `pages across the boundary between fits and maybes` (Review Focus #3): same items, `limit=2` → page 1 `[fit d2, fit d3]`, page 2 `[maybe d1, unscored d2]`, no further page.
  - API test `a cursor without a rank starts from the top` (Review Focus #4): pass `encodeCursor({ starts_at, id })` from the old shape → page 1 again.
  - Extend the existing badge test: `GET /ingest/count` includes `filtered`, and the existing new count does not include the filtered item.
- [ ] **Step 2: Run them.** `pnpm vitest run packages/shared packages/api/src/routes/ingest.test.ts` → FAIL.
- [ ] **Step 3: Implement** the shared schema changes and the route changes.
- [ ] **Step 4: Verify.**
  - `pnpm vitest run` → PASS. Run the whole suite, because the cursor change touches the existing paging tests.
  - `pnpm --filter @open-event-db/api --filter @open-event-db/shared typecheck` → clean. Web type errors from the wider `IngestView` are expected; Task 7 fixes them.
- [ ] **Step 5: Commit.** `git commit -m "Inbox: filtered-out view and fits first in New"`

### Task 6: Accuracy endpoint

**Files:**
- Modify: `packages/shared/src/ingest.ts`
- Modify: `packages/api/src/routes/ingest.ts`
- Test: `packages/api/src/routes/ingest.test.ts`

**Interfaces:**
- Shared:
  - `ingestAccuracyRowSchema = z.object({ slug, name, fit_decided, fit_accepted, no_decided, no_rejected, rescued })`; every count is `z.number().int()`.
  - `type IngestAccuracyRow`.
- API: `GET /api/v1/ingest/accuracy`, scouts only, returns `{ data: IngestAccuracyRow[] }` sorted by source name (`localeCompare(…, 'de')`). It counts items with `decided_at >= now() - interval '60 days'` and `fit_verdict is not null`, excluding rows with `status = 'rejected' and had_duplicates`:
  - `fit_decided`: verdict `fit`, accepted or rejected.
  - `fit_accepted`: verdict `fit`, accepted.
  - `no_decided`: verdict `no`, accepted or rejected.
  - `no_rejected`: verdict `no`, rejected.
  - `rescued`: verdict `no`, accepted.
  - Sources without any such item are absent.

- [ ] **Step 1: Write the failing test.** `reports per-source accuracy over the last 60 days`, on its own source. The response row for that slug equals `{ fit_decided: 2, fit_accepted: 1, no_decided: 2, no_rejected: 1, rescued: 1 }`. Decided items, all with `decidedAt` set:
  - `fit` accepted;
  - `fit` rejected;
  - `fit` rejected with `hadDuplicates` → excluded;
  - `no` rejected;
  - `no` accepted;
  - `maybe` accepted → not counted in either group;
  - `fit` accepted 61 days ago → excluded;
  - unscored accepted → excluded.

  A non-scout gets 403.
- [ ] **Step 2: Run it** → FAIL (404).
- [ ] **Step 3: Implement** with one grouped query using `count(*) filter (where …)`.
- [ ] **Step 4: Verify.** Run it → PASS.
- [ ] **Step 5: Commit.** `git commit -m "Inbox: accuracy of fit verdicts per source"`

### Task 7: Web inbox

**Files:**
- Modify: `packages/web/src/lib/api.ts`. `IngestView` comes from shared; `IngestCounts` gains `filtered`; add `getIngestAccuracy(cookieHeader): Promise<IngestAccuracyRow[]>`.
- Modify: `packages/web/src/app/ingest/page.tsx`. Tabs are New / Filtered out / Gone from source; parse `view` into the three values (anything else → `new`); render `<IngestAccuracy rows={…} />` at the bottom.
- Modify: `packages/web/src/components/IngestInbox.tsx`. The `view` prop is `IngestView`; the select-all and reject bar shows for `new` and `filtered`; the empty text for `filtered` is "Nothing filtered out."
- Modify: `packages/web/src/components/IngestItemCard.tsx`
  - The `view` prop is `IngestView`.
  - After the source badge, show the verdict badge when `item.fit` is set:
    - `fit` → `<span className="kk-badge kk-badge--fit">Fits</span>`
    - `maybe` → `kk-badge kk-badge--scout` "Maybe"
    - `no` → `kk-badge kk-badge--scout` "Doesn't fit"
  - Show the reason as `<p className="kk-hint m-0 text-[14px]">` directly under the badge row.
  - Actions for `filtered` are the same as for `new`.
- Modify: `packages/web/src/styles/kellerkompass/components.css`. Add `.kk-badge--fit { border: 1px solid var(--uv); color: var(--uv); }` next to `.kk-badge--scout`.
- Create: `packages/web/src/components/IngestAccuracy.tsx`
  - A server component: `<section aria-label="Accuracy">` with a `kk-eyebrow` heading "Accuracy", a plain table with the columns from Global Constraints, and the empty text when `rows` is empty.
  - Cells read `{accepted} of {decided} · {percent}%` (percent rounded; "—" when `decided` is 0). "Rescued" is a plain count.

- [ ] **Step 1: Typecheck before the change.** `pnpm --filter @open-event-db/web typecheck` lists the errors that Task 5's wider `IngestView` left. These are the starting point.
- [ ] **Step 2: Implement** the changes above.
- [ ] **Step 3: Verify.** `pnpm typecheck` → clean.
- [ ] **Step 4: Check in the browser.** Start the dev servers (`preview_start` with the names in `.claude/launch.json`, or the running ones on :3000/:3001), sign in as a scout, and set verdicts on a few local pending items with SQL (`docker exec open-event-db-postgres-1 psql -U oedb -d oedb`). Then confirm:
  - "New" lists fits, then maybes, then unscored, with labels and reasons;
  - "Filtered out" shows the `no` items with working Accept and Reject;
  - the header badge does not count filtered items;
  - the source filter and paging still work in all three tabs;
  - after deciding a few items, the accuracy block shows them.

  Take a screenshot of "New" and of the accuracy block.
- [ ] **Step 5: Commit.** `git commit -m "Inbox: fit labels, filtered-out tab and accuracy block"`

### Task 8: Real-model check (with the user)

- [ ] **Step 1: Run the suite.** `pnpm test && pnpm typecheck` → all green.
- [ ] **Step 2: Run a local backfill.** If `.env` has the Scaleway variables, run `pnpm --filter @open-event-db/api ingest:score --limit 40` against the local database. Report the printed counts and 10 sample verdicts with reasons (`select draft->>'title', fit_verdict, fit_reason from ingest_items where fit_verdict is not null order by fit_scored_at desc limit 10`).
- [ ] **Step 3: Hand over.** Show the sample to the user before the fast-forward into main. Taste or prompt changes are a separate follow-up.
