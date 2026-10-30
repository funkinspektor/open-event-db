# LLM Fit Scoring for the Import Inbox — Design

Status: approved in conversation on 2026-10-30, awaiting spec review.

## Why

Kellerkompass is a curated guide for one subculture, not a listing of everything that happens at the venues it reads. Today every event from every feed lands in the inbox, and a scout decides each one by hand. That works for five venues and will not work for fifty or more.

The goal is an LLM quality layer that judges whether an event fits Kellerkompass, so the inbox puts likely fits first and moves clear misfits aside. This spec covers phase 2 of three:

1. Inbox paging and a source filter (done, `f220415`).
2. **Fit scoring in shadow mode plus a "Filtered out" tab (this spec).** The system sorts and labels; it publishes and rejects nothing.
3. Later, separate spec: opt-in auto-publish per source once the agreement numbers from phase 2 are high.

Success for phase 2: every pending item gets a verdict within one or two daily runs, the scout works through "New" faster because fits come first, and the inbox shows per source how often the verdicts matched the scout's decisions.

## Scope

In scope: verdict storage, the scoring pass, the prompt and example selection, the inbox tabs, sort and labels, the accuracy block, and a CLI backfill.

Out of scope: auto-publish; editing the taste description in the app; per-source taste descriptions; reject reasons; bulk "accept all fits".

## 1. Approach and data

**A separate scoring pass at the end of each ingest run.** After all sources are read, `runIngest` (still inside the advisory lock) scores the pending items that need it. The same pass can be started from the CLI to backfill the current inbox.

Rejected alternatives:
- Scoring inline while each source is ingested makes the import depend on the LLM.
- Scoring when the inbox opens adds latency for the scout and repeats work.

**New columns on `ingest_items`** (one migration):

| Column | Type | Meaning |
|---|---|---|
| `fit_verdict` | enum `ingest_fit_verdict` (`fit`, `maybe`, `no`), nullable | Null: not scored yet, or the last call failed |
| `fit_reason` | text, nullable | One sentence, at most about 140 characters |
| `fit_scored_at` | timestamptz, nullable | When the verdict was written |
| `fit_fingerprint` | text, nullable | Hash of the scored event content plus the prompt version |
| `had_duplicates` | boolean, not null, default false | Set when a scout rejects an item that had duplicate candidates |

An item **needs scoring** when all of these hold:
- it is pending,
- it is not gone, and has not ended yet (the same `notOver()` rule the inbox uses),
- its `fit_fingerprint` differs from the fingerprint computed now, or is null.

This covers new items, items whose last call failed, items whose draft changed, and every pending item after a prompt or description change. Accepted, rejected and past items are never scored, so a decided item keeps the verdict it had when it was decided.

**Fingerprint:** `sha256(promptVersion + canonical JSON of the scored fields)`. The scored fields are those listed under "What the model sees" below. `promptVersion` is a hash of the system prompt text and the taste description file, so editing either re-scores everything still pending. **The examples are not part of the fingerprint.** Otherwise every scout decision would re-score the whole inbox; new items pick up recent decisions on their own.

**Model:** the existing Scaleway Generative APIs access (`callScaleway`, `TEXT_MODEL || VISION_MODEL`), asking for a JSON object. Without a configured model (and always in tests, via `isTestRun`) nothing is scored and the import behaves as today.

**Recording duplicates at reject time:** `POST /ingest/items/reject` runs `findDuplicateCandidates` for each item it rejects and sets `had_duplicates = true` when there is at least one candidate. This is the same lookup the inbox card shows. The scout gives no reason; a reject next to a possible duplicate is taken to mean "already there", not "doesn't fit". Items rejected before this change keep `false`.

## 2. Prompt and examples

**Taste description:** a plain text file in the repo, `packages/api/src/ingest/fit/taste.md`, versioned through commits. Initial content, in substance:

> Kellerkompass lists events for the dark alternative scene: Dark Wave, Post-Punk, Goth, Cold Wave, Synth/EBM, Industrial, Dark Techno and related styles. Scene parties and concerts belong, including 80s wave parties. Generic indie or retro parties, exhibitions and art programmes do not, even at scene venues.

Borderline cases are refined later by editing this file.

**Examples**, chosen once per scoring pass so every item in the pass sees the same set:
- **Positive:** the 20 most recently decided items with status `accepted`. This includes items linked to an existing event, since linking means "this belongs".
- **Negative:** the 20 most recently decided items with status `rejected` and `had_duplicates = false`.
- Each example is short: title, venue or location text, and the first ~150 characters of the description.
- Fewer than 20 of either kind is fine; with none, the prompt runs on the description alone.

**What the model sees per item:** title, venue name or location text, source name, start date, categories, and the description cut to ~1,500 characters.

**System prompt:** states the task, includes the taste description, and gives the examples as two lists ("accepted" / "rejected"). It asks for exactly `{"verdict": "fit" | "maybe" | "no", "reason": "<one sentence in English>"}`:
- `fit`: clearly part of the scene.
- `maybe`: unsure, or not enough information to judge.
- `no`: clearly outside the scene.

The prompt explicitly says to choose `maybe` when in doubt, because a fit wrongly filtered out costs more than one extra item in the inbox.

**Parsing:** the reply is validated with Zod. An unknown verdict or invalid JSON counts as a failed call. A reason longer than 200 characters is cut.

**Cost:** roughly 3,000–5,000 input tokens per item, which is cents per week at the current volume.

## 3. Inbox

**Tabs** (UI copy stays English like the rest of the app):

| Tab | View value | Contains |
|---|---|---|
| New | `new` | pending, not gone, not over; verdict `fit`, `maybe` or null |
| Filtered out | `filtered` | pending, not gone, not over; verdict `no` |
| Gone from source | `gone` | unchanged: gone items regardless of verdict |

Filtered-out items stay fully pending. Accept, link and reject work there exactly as in "New".

The source filter, the 50-item pages and the per-view counts work the same in all three tabs. `meta.counts` gains a `filtered` number. `GET /ingest/count` (the header badge) keeps counting only `new` and `gone`, so filtered-out items do not raise the badge.

**Sort order in "New":** `fit` first, then `maybe`, then unscored; within each group by start time, then id, as now. The keyset cursor gains the group rank: `(rank, starts_at, id)`. Old cursors without a rank fail validation and restart from the top, as invalid cursors do today. "Filtered out" and "Gone" sort by start time as before.

**On the card:**
- A small label: "Fits", "Maybe", or "Doesn't fit" (in "Filtered out").
- Below it, the reason in one muted line.
- Unscored items show no label.

The action buttons are unchanged.

**Shadow mode:** the system only sorts and labels. It never publishes and never rejects; every decision stays with a scout. Scouts should look through "Filtered out" now and then. Each item accepted from there is exactly the error the accuracy block counts.

## 4. Accuracy, errors, testing

**Accuracy block** at the bottom of the inbox page, one row per source, over items decided in the last 60 days that had a verdict at decision time:
- **Fits accepted:** of the decided `fit` items, how many were accepted (count and percent).
- **Doesn't fit rejected:** of the decided `no` items, how many were rejected.
- **Rescued:** `no` items that were accepted anyway.

Rejects with `had_duplicates = true` are left out of these numbers. The block reads `ingest_items` directly; no new table is needed, because a decided item's verdict no longer changes. It is served by a new scout-only endpoint `GET /ingest/accuracy`, which the inbox page fetches next to the list.

A suggested bar for enabling auto-publish on a source in phase 3: at least 30 decided `fit` items with at least 95 % accepted. The actual bar is decided in the phase 3 spec, with real numbers.

**Errors:**
- No model configured: nothing is scored; the run result reports `scoring: { skipped: 'no model' }`.
- A call fails (timeout, HTTP error, invalid JSON, unknown verdict): the verdict stays null, a warning is logged with the item id, and the item is retried next run. It shows among the unscored items in "New".
- At most 200 items are scored per pass, 4 calls at a time, soonest start first, so the events closest to happening get a verdict first. The first backfill over the existing inbox spreads over a few runs, or is run from the CLI.
- An error anywhere in the scoring pass is caught and logged. It never fails the ingest run, and the source results stay as they are.

**CLI:** `pnpm --filter @open-event-db/api ingest:score [--limit N]` runs only the scoring pass. It takes the same advisory lock and prints counts of `fit`, `maybe`, `no` and failures.

**Code layout:** `packages/api/src/ingest/fit/`
- `taste.md`: the taste description.
- `prompt.ts`: prompt text, prompt version, example formatting.
- `score.ts`: the pass: select items, select examples, call the scorer, write results.
- `scorer.ts`: the scorer holder with `setScorer()`, mirroring `textExtraction`.

**Testing** (Vitest against the local Postgres; no live LLM; tests install a stub scorer):
- The pass picks new, failed and fingerprint-changed items. It skips decided, gone and past items, and items whose fingerprint matches.
- A throwing or garbage-returning stub leaves the verdict null and does not fail `runIngest`.
- The 200-item cap holds.
- Example selection: rejects with `had_duplicates` are excluded; linked items count as positive; the 20/20 limits and recency order hold.
- Reject sets `had_duplicates` only when a candidate exists.
- List views: `new` / `filtered` / `gone` contents, rank-then-date order, paging across rank boundaries with the new cursor, a garbled cursor, counts including `filtered`, and the badge count excluding filtered items.
- The accuracy endpoint: percentages, the 60-day window, and exclusion of duplicate rejects.
- Prompt quality is not unit-tested. After deploy, the CLI backfill runs once over the real inbox and the result is reviewed together before relying on the sort.
