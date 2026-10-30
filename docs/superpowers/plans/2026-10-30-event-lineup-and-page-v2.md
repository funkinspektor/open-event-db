# Event Lineup Field and Event Page v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Events get a structured lineup (groups of acts) that the event page shows as its own section, filled by the Berghain/Kantine and Dunckerclub adapters, the flyer import and a form editor, with existing events moved over once; the event page gets the approved v2 layout.

**Architecture:** One `lineup` jsonb column on `events` (validated by a shared zod schema) travels through the API, the ingest draft (a synced merge field) and the web form. Adapters that already parse lineups return them as data instead of text. The event page is rebuilt in `EventDetailBody` (shared with the inbox preview) following the canvas boards.

**Tech Stack:** TypeScript, zod, Drizzle (Postgres jsonb), Fastify, Next.js App Router, vitest.

**Spec:** Decisions below, and the approved boards on the "Event v2" page of the canvas https://claude.ai/artifact/UmBavniBV7uqRoGoitn71r (EventV2Mobile, EventV2MobileScout, EventV2Desktop, EventFormLineup, EventFormLineupMobile).

## Decisions (from the design session, 2026-10-30)

- Lineup = ordered groups; a group has an optional name (floor, room, "Live", "DJs") and ordered acts. An act has `name` (required), `time` (`HH:MM` as listed, optional), `live` (bool), `note` (label, crew, country; optional). Order is the listed order; never sort (sets run past midnight).
- Limits: 20 groups, 200 acts per event in total, name ≤ 200, note ≤ 200, group name ≤ 100.
- Phase 1 only. Phase 2 (LLM lineup from free text) is out of scope; when it comes, it leaves the description unchanged. The Berghain/Kantine and Dunckerclub adapters build the description themselves and simply leave the lineup out of it.
- Search stays title-only.
- Event page order (mobile): ← Events / Edit (top row), title, category line under the title, date (bold) + time (small, muted, like the address), venue name → + address, tags, image, Lineup, About (description), Links, map, Source/Organised by, Report. Desktop: same header; main column Lineup, About, Source, Report; sidebar image, map, Links. No horizontal rule. UV only for "Today".
- Title: 40px on phones, 64px from `sm` up (Germania One, line-height 0.95, chrome last word as today).
- Lineup display: group name as a small bold heading, rows `time | act (+ "Live" outline badge) | note`; on phones with more than one group, group pills switch between groups; desktop shows all groups stacked. A single unnamed group shows no heading and no pills.

## Global Constraints

- UI copy in English, sentence case, no exclamation marks; arrows only as the inline SVG icons in `components/Icons.tsx`.
- Colours only from `styles/kellerkompass/tokens.css`; new classes go in the app-only block of `components.css`, prefixed `kk-`.
- Every event write logs history through `logEdit` with `eventSnapshot` (which gains `lineup`).
- Migrations come from `pnpm db:generate`; never hand-number them. If main gained a migration meanwhile, rebase and regenerate before fast-forwarding.
- API and route tests need the local Postgres (`pnpm db:up`, then `pnpm db:migrate`).

## Review Focus

- A form submitted with blank act rows or a group with only blank rows: blanks are dropped client-side, the event saves; an all-blank lineup saves as `[]`.
- An adapter page with more than 200 sets or 20 floors: `normalizeFeedEvent` caps the lineup to the limits, so the source does not fail draft validation.
- Inbox drafts stored before this change (no `lineup` key): they parse as `[]`, the preview renders, and the next run re-reads them once.
- An event with a lineup and an empty description: no "About" heading; a lineup of one unnamed group: no heading, no pills.
- A Markdown description whose bold list is not a lineup ("**Tickets**\n- Presale 10€"): the backfill leaves it alone.

---

### Task 1: Lineup schema, column and event API

**Files:**
- Create: `packages/shared/src/lineup.ts`, `packages/shared/src/lineup.test.ts`
- Modify: `packages/shared/src/index.ts` (export), `packages/shared/src/events.ts` (`eventDetailSchema`, `eventCreateSchema`), `packages/db/src/schema.ts` (`events.lineup`), new migration under `packages/db/migrations/`, `packages/api/src/queries/events.ts` (`eventSnapshot`, `serializeEventDetail`), `packages/api/src/routes/events.ts` (POST, PUT)
- Test: `packages/shared/src/lineup.test.ts`, `packages/api/src/routes/writes.test.ts`

**Interfaces:**
- Produces: `lineupActSchema`, `lineupGroupSchema`, `lineupSchema`, types `LineupAct = { name: string; time: string | null; live: boolean; note: string | null }`, `LineupGroup = { name: string | null; acts: LineupAct[] }`, `Lineup = LineupGroup[]`; constants `LINEUP_MAX_GROUPS = 20`, `LINEUP_MAX_ACTS = 200`; `capLineup(lineup: Lineup): Lineup` (keeps the first groups/acts within the limits, drops groups left empty); `EventDetail.lineup: Lineup`; `EventCreateInput.lineup?: Lineup`; DB `events.lineup` (`jsonb`, `$type<Lineup>()`, not null, default `[]`).

- [ ] **Step 1: Write failing schema tests** in `lineup.test.ts`: `time` accepts `"23:59"`, `"00:30"`, rejects `"24:00"`, `"7:00"`; `live` defaults to `false`, `time`/`note`/group `name` default to `null`; names are trimmed and empty names rejected; 21 groups rejected; 201 acts across groups rejected with a message naming 200; `capLineup` on 3 groups × 100 acts returns 200 acts in order (2 groups) and on 25 groups returns 20.
- [ ] **Step 2: Run** `pnpm vitest run packages/shared/src/lineup.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement `lineup.ts`** (total-act limit as a `superRefine` on the array) and export it from `index.ts`.
- [ ] **Step 4: Run the test** — PASS.
- [ ] **Step 5: Add the column** to `events` in `schema.ts`, run `pnpm db:generate` and `pnpm db:migrate`; check the generated SQL is a single `ADD COLUMN "lineup" jsonb DEFAULT '[]'::jsonb NOT NULL`.
- [ ] **Step 6: Write failing route tests** in `writes.test.ts`: POST with a two-group lineup returns it in `data.lineup` unchanged (order kept); PUT with `lineup: []` clears it and the latest `edit_history` row's diff has a `lineup` entry; POST with 201 acts answers 400; an event created without `lineup` returns `[]`.
- [ ] **Step 7: Run** `pnpm vitest run packages/api/src/routes/writes.test.ts` — the new cases FAIL.
- [ ] **Step 8: Wire it up**: `lineup: lineupSchema.optional()` in `eventCreateSchema` (update inherits), `lineup: lineupSchema` in `eventDetailSchema`, insert `lineup: body.lineup ?? []`, patch on PUT, `lineup` in `eventSnapshot` and `serializeEventDetail`. Slim rows stay without it.
- [ ] **Step 9: Run** the route tests and `pnpm typecheck` — PASS.
- [ ] **Step 10: Commit** `Events: structured lineup field`.

### Task 2: Lineup through ingest (draft, sync, link, accept, one-time upgrade)

**Files:**
- Modify: `packages/shared/src/ingest.ts` (`ingestDraftSchema.lineup`, `ingestMergeFieldSchema` gains `'lineup'`), `packages/api/src/ingest/adapters/ical.ts` (`FeedEvent.lineup?: Lineup`), `packages/api/src/ingest/normalize.ts`, `packages/api/src/ingest/merge.ts`, `packages/api/src/ingest/run.ts` (`ingestEvent`, `syncEvent`), `packages/api/src/routes/ingest.ts` (accept insert near line 342), `packages/api/src/ingest/fit/prompt.ts` (`subjectOf`)
- Test: `packages/api/src/ingest/normalize.test.ts`, `packages/api/src/ingest/run.test.ts`, `packages/api/src/routes/ingest.test.ts`

**Interfaces:**
- Consumes: Task 1 schema and `capLineup`.
- Produces: `IngestDraft.lineup: Lineup` (zod default `[]`); `FeedEvent.lineup` optional; merge field `'lineup'` (therefore in `INGEST_SYNCED_FIELDS`).

- [ ] **Step 1: Failing tests.** normalize: `ev.lineup` passes through; a 250-act lineup comes out capped at 200; no `ev.lineup` gives `[]`. run: (a) a synced item whose new draft carries a lineup updates the event's `lineup` and `description` and logs `via: 'ingest'`; (b) an item stored without a `lineup` key and an unchanged hash is read again; (c) the one-time upgrade below; (d) an accepted, unsynced item whose event description was edited by hand keeps the event untouched. ingest routes: accept copies `lineup` to the new event; link with `fields: ['lineup']` copies it.
- [ ] **Step 2: Run** the three test files — new cases FAIL.
- [ ] **Step 3: Implement.** Draft schema + merge field; `normalizeFeedEvent` sets `lineup: capLineup(ev.lineup ?? [])`; `mergePatch` and `syncEvent` patch `lineup`; accept inserts `draft.lineup`. Re-read condition in `ingestEvent` becomes `'categories' in item.draft && 'lineup' in item.draft`. One-time upgrade, in `ingestEvent` after the new draft is built: when the stored draft had no `lineup` key, the item is accepted, not detached and not synced, its event has an empty lineup, and the event's description (trimmed) equals the stored draft's description (trimmed), then set the event's `description` and `lineup` from the new draft and log it like `syncEvent` does (`via: 'ingest'`). `subjectOf` appends act names to the description only when the lineup is non-empty (`"… Lineup: A, B"`), so other fingerprints stay the same.
- [ ] **Step 4: Run** the tests and `pnpm typecheck` — PASS.
- [ ] **Step 5: Commit** `Ingest: lineup as a synced draft field`.

### Task 3: Berghain/Kantine and Dunckerclub adapters return the lineup

**Files:**
- Modify: `packages/api/src/ingest/adapters/berghain.ts` (`setLine` → act, `parseBerghainDetail`), `packages/api/src/ingest/adapters/dunckerclub.ts` (`detailsOf`)
- Test: `packages/api/src/ingest/adapters/berghain.test.ts`, `packages/api/src/ingest/adapters/dunckerclub.test.ts`

**Interfaces:**
- Consumes: `LineupAct`, `Lineup`, `FeedEvent.lineup`.
- Produces: feed events whose `description` no longer contains the lineup.

- [ ] **Step 1: Update the tests first.** Berghain fixture `event-80749` (or whichever fixture the current test at line ~101 uses): `lineup` has groups named `Berghain`, `Panorama Bar`, … with acts like `{ time: '23:59', name: 'Alex Kassian', live: false, note: 'Love On The Rocks' }`; a `(Live)` act has `live: true` and no "(Live)" in its name; "Spekki Webu b2b Lilian Stark" stays one act; the Kantine fixture `event-81644` has one group with `name: null` and acts `zeug`/`vold` live; descriptions now read `Einlass 19:00\n\nTickets: …` with no set lines. Dunckerclub: the lineup lines become one unnamed group, one act per line; the description keeps genres and the Facebook link only.
- [ ] **Step 2: Run** both adapter test files — FAIL.
- [ ] **Step 3: Implement.** `setLine` returns `{ act: LineupAct; end: string | null }`; floors become groups (heading text or `null`); description drops the lineup parts.
- [ ] **Step 4: Run** the adapter tests plus `run.test.ts` — PASS.
- [ ] **Step 5: Commit** `Feed ingest: Berghain and Dunckerclub lineups as data`.

### Task 4: Web lineup model, paste parser, flyer prefill, merge row

**Files:**
- Create: `packages/web/src/lib/lineup.ts`, `packages/web/src/lib/lineup.test.ts`
- Modify: `packages/web/src/lib/draft.ts` (+ `draft.test.ts`), `packages/web/src/lib/merge.ts` (+ `merge.test.ts`)

**Interfaces:**
- Produces: `type LineupRow = { time: string; name: string; live: boolean; note: string }`, `type LineupGroupRow = { name: string; acts: LineupRow[] }`; `toLineupRows(lineup: Lineup): LineupGroupRow[]`; `fromLineupRows(groups: LineupGroupRow[]): Lineup` (trims; drops acts without a name and groups without acts; empty strings → `null`); `parseLineupText(text: string): LineupGroupRow[]`; `EventPrefill.lineup: Lineup`; merge row key `'lineup'`, label `Lineup`.

- [ ] **Step 1: Failing tests.** `parseLineupText("Panorama Bar:\n22:00 Courtney Bailey b2b Hitomi – second circle\n04.30 Z@P (Live) – Cartulis Music\nSäule:\nTimnah")` → two groups; `04.30` becomes `04:30`; `Z@P` live with note `Cartulis Music`; `Timnah` with empty time and note. Lines before any heading form an unnamed group; blank lines are skipped; a hyphenated name like `Jean-Michel` is not split (only ` – ` or ` - ` with spaces splits). `fromLineupRows` drops a row with only a time and a group with only blank rows. `draftToPrefill` puts `['Der Schrauber', 'Bloodygrave']` into one unnamed group and leaves the description untouched (replaces the "puts the lineup under the description" test). `mergeRows` adds a `lineup` row when the lineups differ (deep compare) and initial side `feed` when the event's lineup is empty.
- [ ] **Step 2: Run** `pnpm vitest run packages/web/src/lib` — new cases FAIL.
- [ ] **Step 3: Implement**; delete `withLineup`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Web: lineup rows, paste parser and prefill`.

### Task 5: Lineup editor in the event form, merge panel

**Files:**
- Create: `packages/web/src/components/LineupEditor.tsx`
- Modify: `packages/web/src/components/EventForm.tsx` (state + submit, placed right after Description), `packages/web/src/components/IngestMergePanel.tsx` (case `'lineup'`: act names per group, `Empty` when none), `packages/web/src/styles/kellerkompass/components.css`

**Interfaces:**
- Consumes: Task 4 `LineupGroupRow`, `toLineupRows`, `fromLineupRows`, `parseLineupText`.
- Produces: `<LineupEditor value={LineupGroupRow[]} onChange={(groups) => void} />`.

- [ ] **Step 1: Build `LineupEditor`** as on the EventFormLineup boards: label "Lineup (optional)" with a "Paste list" toggle (`kk-tag`, `aria-pressed`); paste panel with the hint "One act per line. “22:00 Name (Live) – Label” is understood; a line ending in “:” starts a group.", button "Add to lineup" appends parsed groups; per group a name input (shown when there is more than one group or it has a name) with remove; per act: time input (placeholder "Time"), name ("Artist, DJ or act"), "Live" toggle, note ("Label, crew, country"), remove `kk-iconbtn` ×; "+ Add act" per group, "+ Add group (floor, room, Live / DJs)" below; hint "Shown as its own section on the event page, in this order. Time and note are optional." Rows wrap to two lines under 560px as on the mobile board. Every input has an `aria-label`.
- [ ] **Step 2: Wire into `EventForm`**: state from `event?.lineup ?? pre?.lineup ?? []` via `toLineupRows`; submit `lineup: fromLineupRows(groups)`. An empty editor starts with no groups and shows "+ Add act", which creates one unnamed group.
- [ ] **Step 3: Verify in the browser** (preview `web` + `api`): create an event with two groups via "Paste list", save, reopen edit — groups, times, live and notes survive; remove all acts, save — lineup is `[]`; at 375px the rows wrap without horizontal scroll.
- [ ] **Step 4: Run** `pnpm typecheck` and `pnpm vitest run packages/web` — PASS.
- [ ] **Step 5: Commit** `Event form: lineup editor`.

### Task 6: Event page v2

**Files:**
- Create: `packages/web/src/components/LineupView.tsx` (client: group pills on phones)
- Modify: `packages/web/src/components/EventDetailBody.tsx`, `packages/web/src/app/events/[id]/page.tsx`, `packages/web/src/app/ingest/[id]/page.tsx` (pass `lineup`), `packages/web/src/lib/format.ts` (+ `format.test.ts`), `packages/web/src/styles/kellerkompass/components.css`

**Interfaces:**
- Consumes: `Lineup`, `EventDetail.lineup`, `IngestDraft.lineup`.
- Produces: `EventDetailBody` props: `lineup: Lineup` added; `headerAction` replaced by `topAction?: React.ReactNode` (rendered right of "← Events"); `formatEndDayMark(startsAt: string, endsAt: string | null): string | null` returns the short weekday (`"Sat"`) when the event ends on a later Berlin day, else `null`; `formatShortDate(iso: string): string` → `"Fri, 30 October"`.

- [ ] **Step 1: Failing format tests**: `formatEndDayMark('2026-10-30T18:00:00Z', '2026-10-31T10:30:00Z')` → `'Sat'`; same-day end → `null`; `null` end → `null`; `formatShortDate('2026-10-30T18:00:00Z')` → `'Fri, 30 October'`.
- [ ] **Step 2: Run** — FAIL; **implement**; run — PASS.
- [ ] **Step 3: Rebuild `EventDetailBody`** in the order from Decisions: top row (`← Events` link to `/`, `topAction`), title (40px / 64px from `sm`), category line (`kk-eyebrow`, e.g. "Concert · Party") under the title, date line bold 20px with UV "Today ·" prefix when `relativeDayLabel` says Today, time line in the address style (`19:00 – 11:30 (Sat)`, "From 23:00" without end, nothing when the start time is unknown, recurrence appended muted), venue name as Germania link with the next arrow + address (or location text + city, no link), tags, image (phones), Lineup (`LineupView`), About (eyebrow "About" only when there is a description), Links (phones: after About; `sm` up: sidebar under the map), map, `children` (source/organisers), report link. Remove the `kk-rule`.
- [ ] **Step 4: `LineupView`**: rows `time | name + Live badge | note` with `line` hairlines; group names as headings; with more than one group, pills (`kk-tag kk-tag--filter`, `aria-pressed`) switch groups below `sm`, and all groups show from `sm` up; one unnamed group: no heading, no pills; acts without times drop the time column for that group.
- [ ] **Step 5: Event page**: pass `lineup`, move "Edit event" into `topAction` as a small outline button (`Edit` on phones, `Edit event` from `sm`).
- [ ] **Step 6: Verify in the browser** against the boards on a seeded event with three groups and one scout event without venue: 375px and 1280px, no horizontal scroll, pills switch groups on 375px, the inbox preview of a feed item still renders.
- [ ] **Step 7: Run** `pnpm typecheck` and `pnpm vitest run packages/web` — PASS.
- [ ] **Step 8: Commit** `Event page: v2 layout with lineup section`.

### Task 7: Backfill for Markdown lineups

**Files:**
- Create: `packages/api/src/lineup/markdown.ts`, `packages/api/src/lineup/markdown.test.ts`, `packages/api/src/lineup/backfill-cli.ts`
- Modify: `packages/api/package.json` (script `lineup:backfill`), `DEPLOY.md` (rollout section)

**Interfaces:**
- Consumes: `Lineup`, `capLineup`, `logEdit`, `eventSnapshot`.
- Produces: `splitMarkdownLineup(description: string): { lineup: Lineup; description: string } | null`.

- [ ] **Step 1: Failing parser tests** with the real prod shapes: `"Berlin's current Goth/Wave/Post-Punk/EBM ritual with a Halloween special.\n\n**Lineup**\n- NecroPhil\n- Frank Booth"` → one unnamed group, description is the first sentence only. `"…\n\n**Live**\n- Volcan\n- Dardo\n\n**DJs**\n- Paura Diamante"` → groups `Live`, `DJs`. `"…\n\n**Dj Lineup after the show**\n- Mara Mortem"` → group `Dj Lineup after the show`. The Renate shape: `**Lineup**` list followed by `BLACK (hosted by Jiãla)\n- Coco Cobra [Queerpool]\n…\n\nGREEN (hosted by casadephunk)\n- …` → the plain-line headings become groups too, and the description keeps only the text before. `"**Tickets**\n- Presale 10€"` → `null`. The first heading must match `/^(dj\s*)?(line-?up|live|djs?)\b/i`; following heading+list blocks are taken as long as they directly follow.
- [ ] **Step 2: Run** — FAIL; **implement**; run — PASS.
- [ ] **Step 3: CLI** `pnpm --filter @open-event-db/api lineup:backfill [--write]`: selects events with an empty lineup whose description yields a split; without `--write` prints per event id, title, the parsed groups and the new description, plus a count; with `--write` updates both fields in one transaction per event and logs `action: 'updated'`, diff plus `via: 'cli'`, as publisher `kellerkompass-import` (looked up by slug; abort if missing).
- [ ] **Step 4: DEPLOY.md**: rollout = deploy → next ingest run (or `scripts/prod-db.sh pnpm --filter @open-event-db/api ingest berghain kantine duncker`) re-reads the adapter items and upgrades untouched unsynced events → `scripts/prod-db.sh pnpm --filter @open-event-db/api lineup:backfill` (dry run, review) → same with `--write`.
- [ ] **Step 5: Run** against the local DB with a seeded scout event (dry run, then `--write`, then dry run shows 0).
- [ ] **Step 6: Commit** `Lineup: backfill for Markdown lineups`.

### Task 8: Whole-branch check

- [ ] **Step 1:** `pnpm test` and `pnpm typecheck` — all green (report failures verbatim).
- [ ] **Step 2:** Browser pass on event page (mobile/desktop), edit form, inbox preview and merge panel.
- [ ] **Step 3:** Rebase onto `main`; if `main` gained a migration, regenerate ours; offer the fast-forward and push.
