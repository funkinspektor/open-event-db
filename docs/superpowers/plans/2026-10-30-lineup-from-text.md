# Lineups from Description Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An LLM step reads the lineup out of an event's description text. It fills feed drafts during ingest (per source, opt-in), and it fills the event editor on request through a "Read from description" button. The description text never changes.

**Architecture:**
- A new `extract/lineup.ts` calls Scaleway through the existing `callScalewayJson`. The model output always passes a pure name check against the text before anyone sees it.
- `ingestEvent` runs the reader next to `extractTimes`. A draft marker forces one re-read per stored item when a source is switched on.
- A new route serves the editor button.
- An eval CLI measures recall and precision on about 25 real venue texts.

**Tech Stack:** TypeScript, zod, Fastify, Drizzle/Postgres, Vitest, Next.js (App Router), Scaleway Generative APIs.

**Spec:** `docs/superpowers/specs/2026-10-30-lineup-from-text-design.md`

## Global Constraints

- The description text is never modified by any part of this feature.
- The ingest path and the endpoint only ever see the checked result of `checkAgainstText`, never raw model output.
- The model is `TEXT_MODEL || VISION_MODEL` (an empty `TEXT_MODEL` counts as unset). Tests never call the provider (`isTestRun`).
- Source config key `lineup_from_text`, draft key `lineup_from_text`, both `z.boolean().default(false)`.
- Endpoint: `POST /api/v1/events/extract-lineup`.
  - Body `{ text }` with 1–10,000 characters.
  - `requireAuth`, a daily limit of `EXTRACT_DAILY_LIMIT` per account.
  - Errors: 503/504/502/422 as for `/events/extract`, and an empty checked lineup → 422 `nothing_extracted`.
- Button copy: "Read from description". Empty-result message: "No lineup found in the description".
- Eval release bar: precision ≥ 95% and recall ≥ 85% on the chosen model.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions this plan adds to the spec

- **Response shape `{ data: { lineup } }`.** Every API route wraps its payload in `data`. The spec's `{ lineup }` is the inner object.
- **Own rate-limit counter, same limit.** `@fastify/rate-limit` 10.3 gives each route its own store (`LocalStore.child`), so the two routes cannot share one counter without a custom store. The lineup route gets its own daily counter with the same `EXTRACT_DAILY_LIMIT` and key prefix `extract-lineup:`. A text call costs a fraction of an image call.
  - Cost if wrong: an account can make twice the daily calls, half of them cheap text calls.
- **Replace-or-append lives in the web lib.** It is `mergeReadLineup` in `lib/lineup.ts`, since the web package has no component tests. The editor only wires it.

## Review Focus

1. **Names that occur only in prose** ("SPK are one of the founding names…", influences, past tours) pass the name check, because they are in the text. Only the prompt keeps them out. The eval has prose-only and no-lineup cases (Task 6) that must come back empty.
2. **Non-ASCII and decorated names** ("DJ Ørlög", "Ai 爱", "▷ Uwe Marx", "**Bragolin**(live)") must survive the name check. Test in Task 2.
3. **A failed read on a changed text** must not wipe an event's existing lineup. There is no sync on failure, and the stored hash is null so the next run retries. Test in Task 3.
4. **Detached or rejected items** must never be read and never be force-re-read. Otherwise every run re-writes them and counts them as updated. Test in Task 3.
5. **Editor with unsaved description edits:** the button reads the text currently in the form, not the saved one. The editor also appends rather than wipes acts someone already typed. Tests in Task 5 (`mergeReadLineup`) and the browser check.

---

### Task 1: Config and draft fields

**Files:**
- Modify: `packages/shared/src/ingest.ts` (`ingestSourceConfigSchema`, `ingestDraftSchema`)
- Test: `packages/shared/src/ingest.test.ts`

**Interfaces:**
- Produces:
  - `IngestSourceConfig.lineup_from_text: boolean`
  - `IngestDraft.lineup_from_text: boolean`, default `false`, comment "true once the lineup step read this draft's text"

- [ ] **Step 1: Write the failing tests**

```ts
it('defaults lineup_from_text to false on source configs', () => {
  expect(ingestSourceConfigSchema.parse({}).lineup_from_text).toBe(false)
  expect(ingestSourceConfigSchema.parse({ lineup_from_text: true }).lineup_from_text).toBe(true)
})
it('reads a draft stored before the lineup step as not read', () => {
  const { lineup_from_text: _, ...older } = view.draft
  expect(ingestItemViewSchema.parse({ ...view, draft: older }).draft.lineup_from_text).toBe(false)
})
```

- [ ] **Step 2: Run them.** `pnpm --filter @open-event-db/shared test -- ingest` → FAIL (property undefined).
- [ ] **Step 3: Add both fields.** Add `lineup_from_text: false` wherever test fixtures build full drafts and the typecheck asks for it.
- [ ] **Step 4: Run** `pnpm --filter @open-event-db/shared test` and `pnpm -r typecheck` → PASS.
- [ ] **Step 5: Commit** "Lineup reading: config and draft fields".

### Task 2: The lineup reader and the name check

**Files:**
- Create: `packages/api/src/extract/lineup.ts`
- Test: `packages/api/src/extract/lineup.test.ts`

**Interfaces:**
- Consumes:
  - `callScalewayJson`, `ExtractionError`, `isTestRun` and `ScalewayConfig` from `./vision.js`
  - `sanitizeLineup` and `Lineup` from shared
- Produces:
  - `interface LineupReader { read(text: string): Promise<Lineup> }`. It returns the checked, sanitized lineup.
  - `scalewayLineup(config: ScalewayConfig): LineupReader`
  - `lineupReading`: `{ reader, setReader(r), reset() }`, with the same env rules as `textExtraction` (unavailable → `ExtractionError('unavailable', 'Lineup reading is not configured on this server')`)
  - `checkAgainstText(lineup: Lineup, text: string): Lineup`, a pure function
  - `LINEUP_SYSTEM_PROMPT: string`

- [ ] **Step 1: Write the failing tests for `checkAgainstText`.** One `it` each:
  - drops an act whose name is not in the text
  - keeps `"Bragolin"` from `"**Bragolin**(live)"`, `"Uwe Marx"` from `"▷ Uwe Marx"`, `"DJ Ørlög"` from `"dj ørlög //"` and `"Ai 爱"` from `"x Ai 爱 [Whacking Berlin]"`
  - matches across collapsed whitespace and line breaks (`"Marko  \nKönig"` ↔ `"Marko König"`)
  - clears a note not in the text but keeps the act
  - turns a group name not in the text into `null`
  - drops a group left without acts
  - an empty input lineup → `[]`

- [ ] **Step 2: Write the failing tests for the reader.** Stub the provider with `vi.spyOn(globalThis, 'fetch')` returning a chat completion whose content is `{"groups":[…]}`:
  - `scalewayLineup(cfg).read(text)` returns the checked lineup: an invented act in the stub output is gone
  - a time like `"0:30"` comes back as `"00:30"` through sanitize
  - non-JSON content rejects with `ExtractionError` kind `invalid_output`

- [ ] **Step 3: Run them.** `pnpm --filter @open-event-db/api test -- extract/lineup` → FAIL (module missing).

- [ ] **Step 4: Implement `lineup.ts`.**
  - **Match normalisation**, applied to both sides before `includes`: NFC, lowercase, `[*_\[\]▷#]` → space, whitespace runs → one space, trim. A name that is empty after normalising is dropped.
  - **JSON schema:** root `{groups: [{name: string|null, acts: [{name: string, time: string|null, live: boolean, note: string|null}]}]}`, strict, all properties required.
  - **Zod parse** with plain strings, so a limit breach never fails the call: `sanitizeLineup` clips it after the check.
  - **Call:** `label: 'Lineup'`, `schemaName: 'lineup'`, `maxTokens: 4000`.
  - **`LINEUP_SYSTEM_PROMPT`** states the spec's prompt rules (§1 "Prompt rules") as a list. Add one short worked example in the prompt: "on decks: ▷ A ▷ B" → one unnamed group with A and B.

- [ ] **Step 5: Run** the tests → PASS. Run `pnpm -r typecheck` → PASS.
- [ ] **Step 6: Commit** "Lineup reading: reader and name check".

### Task 3: Ingest reads lineups

**Files:**
- Modify: `packages/api/src/ingest/run.ts` (`ingestEvent`, a new `readLineup` next to `extractTimes`, the skip condition)
- Test: `packages/api/src/ingest/run.test.ts`

**Interfaces:**
- Consumes: `lineupReading` from Task 2, `lineup_from_text` from Task 1.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests.** Use a source with `lineup_from_text: true`, an iCal fixture whose description names acts, and `lineupReading.setReader(stub)` with `reset()` in `afterEach`:
  - stores the read lineup and `lineup_from_text: true` on a new item, and the draft description equals the feed description byte for byte
  - does not call the reader when the source does not set `lineup_from_text`, when the description is empty, or when the adapter delivered a lineup (Dunckerclub fixture)
  - an accepted, attached event takes the read lineup through the sync, and its description is unchanged
  - an unchanged feed re-reads a stored draft without the marker exactly once; the second run makes no reader call
  - a rejected item and a detached item are not read, and a second run does not count them as updated (Review Focus 4)
  - on a reader failure (`ExtractionError('timeout')`), a changed text does not sync: the event keeps its earlier lineup (Review Focus 3); the item's `contentHash` is null and the marker false; the next run with a working reader syncs
  - an `unavailable` reader fails the source with a `lastError` starting "Source sets lineup_from_text, but lineup reading is unavailable"

- [ ] **Step 2: Run them.** `pnpm --filter @open-event-db/api test -- ingest/run` → the new tests FAIL.

- [ ] **Step 3: Implement.**
  - `readLineup(ev, config, settled): Promise<{ lineup: Lineup | null; failed: boolean }>` mirrors `extractTimes`.
  - In `ingestEvent`, after `normalizeFeedEvent`, a successful read sets `draft.lineup` and `draft.lineup_from_text = true`, before `ingestDraftSchema.parse`.
  - `failed` becomes `timesFailed || lineupFailed` for `contentHash` and the sync gate.
  - Skip condition: the existing one AND NOT (`config.lineup_from_text` and the stored draft's `lineup_from_text !== true` and `!ev.lineup?.length` and the item is not settled). Use the same `settled` rule: rejected or `detachedAt` set.

- [ ] **Step 4: Run** `pnpm --filter @open-event-db/api test` → PASS (whole API suite).
- [ ] **Step 5: Commit** "Ingest: read lineups from description text".

### Task 4: Endpoint for the editor

**Files:**
- Modify: `packages/api/src/routes/extract.ts`
- Test: `packages/api/src/routes/extract.test.ts` (new `describe('POST /events/extract-lineup')`)

**Interfaces:**
- Consumes: `lineupReading` (Task 2).
- Produces: `POST /api/v1/events/extract-lineup`.
  - Body `{ text: string }`, 1–10,000 characters, validated with zod (400 `bad_request` otherwise).
  - 200 `{ data: { lineup: Lineup } }`.
  - Error codes `extraction_unavailable`, `extraction_timeout`, `extraction_provider_error`, `extraction_failed` and `nothing_extracted`, with lineup-worded messages: "Reading the lineup is not available right now", "Reading the lineup took too long", "The lineup could not be read right now", "The lineup could not be read", "No lineup found in the description".

- [ ] **Step 1: Write the failing tests:**
  - 401 without auth
  - 200 with the stub's checked lineup
  - 400 for an empty text and for 10,001 characters
  - each `ExtractionError` kind → its status and code, without leaking the provider message
  - an empty checked lineup → 422 `nothing_extracted`
  - the `x-ratelimit-remaining` header drops by one per call
- [ ] **Step 2: Run them** → FAIL (404).
- [ ] **Step 3: Implement** the route next to `/events/extract`, with its own `rateLimit` config: `max: EXTRACT_DAILY_LIMIT`, `timeWindow: '1 day'`, key `extract-lineup:${publisher id ?? ip}`. Move the failure table into a function that takes the noun ("image" / "lineup"), so both routes share it.
- [ ] **Step 4: Run** `pnpm --filter @open-event-db/api test -- routes/extract` → PASS.
- [ ] **Step 5: Commit** "API: read a lineup from description text".

### Task 5: "Read from description" in the editor

**Files:**
- Modify: `packages/web/src/lib/lineup.ts`, `packages/web/src/components/LineupEditor.tsx`, `packages/web/src/components/EventForm.tsx`
- Test: `packages/web/src/lib/lineup.test.ts`

**Interfaces:**
- Consumes: the endpoint from Task 4.
- Produces: `mergeReadLineup(current: LineupGroupRow[], read: Lineup): LineupGroupRow[]`, and a new `LineupEditor` prop `description: string`.

- [ ] **Step 1: Write the failing tests:**
  - replaces an editor that holds no named act (`[]`, or one group with one blank row) with `toLineupRows(read)`
  - appends below when any act has a name, keeping the existing rows unchanged (Review Focus 5)
- [ ] **Step 2: Run them.** `pnpm --filter @open-event-db/web test -- lineup` → FAIL.
- [ ] **Step 3: Implement** `mergeReadLineup`, then the button in `LineupEditor`:
  - It sits next to "Paste list" with the class `kk-tag`.
  - It is disabled while `description.trim()` is empty or a request runs, and shows "Reading…" while busy.
  - It sends `fetch(`${API_URL}/api/v1/events/extract-lineup`, { method: 'POST', credentials: 'include', headers: {'content-type':'application/json'}, body: JSON.stringify({ text: description }) })`.
  - On success it calls `onChange(mergeReadLineup(groups, json.data.lineup))`.
  - On failure it shows a `kk-hint` error line: the server message for `nothing_extracted`, otherwise "The lineup couldn’t be read. Try again or fill it in by hand."
  - `EventForm` passes `description={description}`.
- [ ] **Step 4: Run** `pnpm --filter @open-event-db/web test` and `pnpm -r typecheck` → PASS.
- [ ] **Step 5: Browser check** on the worktree dev servers (`web-lineup` and `api-lineup`, with a stub-free local `.env`).
  - Open an event with acts in its description, edit the description without saving, and press the button. The lineup fills from the edited text.
  - Press it again: the groups are appended.
  - At 375px, check there is no horizontal scroll.
  - If no model is configured locally, the 503 message shows instead. That also counts as checked for the error path.
- [ ] **Step 6: Commit** "Editor: read the lineup from the description".

### Task 6: Eval

**Files:**
- Create: `packages/api/src/extract/lineup-eval.ts`, `packages/api/src/extract/lineup-eval/cases.json`
- Modify: `packages/api/package.json` (script `"eval:lineup": "tsx --env-file-if-exists=../../.env src/extract/lineup-eval.ts"`)
- Test: `packages/api/src/extract/lineup-eval.test.ts` (the scoring function only)

**Interfaces:**
- Consumes: `scalewayLineup` and `checkAgainstText` (Task 2).
- Produces: `scoreCase(expected: Lineup, got: Lineup): { expected: number; found: number; returned: number; correct: number; liveRight: number }`.
  - Acts are matched by the Task 2 normalisation of their names, ignoring groups.
  - `found` counts expected acts that were returned.
  - `correct` counts returned acts that were expected.
  - `liveRight` counts matched acts with an equal `live`.

- [ ] **Step 1: Write the failing tests** for `scoreCase`: a perfect match, one missed act, one extra act, one wrong live flag, an expected-empty case with an empty result (counts as fully correct).
- [ ] **Step 2: Run them** → FAIL. **Step 3: Implement** `scoreCase` and the CLI.
  - The CLI takes `[--models a,b]` with the default `TEXT_MODEL || VISION_MODEL`.
  - It runs every case per model and prints recall = Σfound/Σexpected, precision = Σcorrect/Σreturned (1 when nothing was returned), and live accuracy, plus the failed cases with their diffs.
  - It writes `lineup-eval/results-<timestamp>.json`, which is gitignored.
- [ ] **Step 4: Build `cases.json`**, about 25 cases `{ id, source, text, expected: Lineup }`, from the public prod API texts of Urban Spree, Slaughterhouse, Badehaus and ACUD. It must include:
  - at least 5 cases with "(live)" plus "[Label]"
  - the "on decks: ▷" and "djs / + special guest:" Slaughterhouse forms
  - all three "Factory" texts, where "Factory DJs" is not an act
  - at least 3 prose-only or no-lineup texts expecting `[]` (e.g. Wisborg, Girls Under Glass, Ball Pink Noir) (Review Focus 1)
  - Draft `expected` by hand from the text.
- [ ] **Step 5: Commit** "Eval for lineup reading". **STOP: the user checks `cases.json`.** Apply their corrections and commit.
- [ ] **Step 6: Run** `pnpm --filter @open-event-db/api eval:lineup`. Below the release bar, improve `LINEUP_SYSTEM_PROMPT` (Task 2 tests stay green) and re-run, at most three rounds, then report. **STOP: show the user the numbers and the failed cases.**

### Task 7: DEPLOY.md

**Files:** Modify `DEPLOY.md`, adding a "Lineups from text" paragraph after "Lineups".

- [ ] **Step 1: Write the section.**
  - What `lineup_from_text` does, and that the description stays as it is.
  - The `ingest-set-config` commands for `urbanspree`, `slaughterhouse`, `badehaus` and `acud`.
  - That the first run after switching a source on reads every stored, unsettled item of that source once, so run it from the laptop with `scripts/prod-db.sh pnpm --filter @open-event-db/api ingest`, then `ingest:score` until `scored: 0`.
  - That pending items of these sources are scored once more.
  - That the editor button shares no counter with image import but has the same daily limit.
- [ ] **Step 2: Run the full suite.** `pnpm -r test` and `pnpm -r typecheck` → PASS.
- [ ] **Step 3: Commit** "Deploy notes: lineups from text".
