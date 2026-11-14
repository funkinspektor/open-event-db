# Suggestions (step 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every onboarded account can suggest an event (form incl. flyer import and image); suggestions land in the scout inbox, scouts edit & accept or reject with a reason, the person sees status in "My suggestions" and gets a mail when it is live.

**Architecture:** Suggestions are `ingest_items` of one built-in source of kind `suggestion` (migration 0024), so accept/reject/merge, duplicate hints, fit scoring and counts are reused. New user routes live in `packages/api/src/routes/suggestions.ts`; the inbox routes gain an optional edited event on accept, a reject reason, the submitter's record and the "live" mail. The web app reuses `EventForm` in two new modes: `suggest` (person) and `accept` (scout, from the inbox).

**Tech Stack:** pnpm monorepo; Drizzle 0.36 / drizzle-kit 0.30 on Postgres 16 (`packages/db`), Zod (`packages/shared`), Fastify (`packages/api`), Next.js 15 App Router (`packages/web`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-suggestions-design.md`

## Global Constraints

- Tests run only against `DATABASE_URL=postgres://oedb:oedb@localhost:5432/oedb_regint` (exists locally; migrate it with that URL after Task 1). Never the default `oedb` DB; never `pnpm db:down`/`db:up`.
- Copy rule: nothing a suggesting person sees says "scout". Use "the Kellerkompass team".
- Exact copy (web): above the button "The Kellerkompass team reviews your suggestion before it goes live. If it's accepted, your display name is shown as ‘Added by’." · button "Send suggestion" · after sending "Thanks! The Kellerkompass team will review it. We'll email you when it's live." · limit "You've sent 5 suggestions today. Try again tomorrow." (number from the API) · reject field label "Reason (shown to the person)" · conflict "Someone else decided this item meanwhile." · entry point "Suggest event".
- Env: `SUGGESTIONS_PER_DAY` (default 5), `SUGGESTION_IMAGE_KEEP_DAYS` (default 30). Reject reason ≤ 500 chars.
- Mail: subject "Your event is live on Kellerkompass", body with title, date and the live event's link; sent in the background after commit, failures logged.
- Suggestions are visible only to scouts (inbox) and their submitter. No public route exposes them or any count.
- `POST /events` keeps `requireRights`; the extract routes move to `requireOnboarded` and keep `EXTRACT_DAILY_LIMIT` per account.
- Commits in the repo style (`DB: …`, `API: …`, `Web: …`, `Docs: …`), each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push.

## Rulings made while planning (spec silent or refined)

- **R1 Suggestions are never "Filtered out".** A misfit verdict on a suggestion shows as its label but the item stays in New; a person's suggestion must not disappear from sight because of a shadow model.
- **R2 Past suggestions are refused.** The inbox hides items that are over (`notOver()`), so `POST /suggestions` returns 400 `event_over` when the event's effective end (`effectiveEnd` from `@open-event-db/shared`) is before now.
- **R3 Daily limit under a per-account advisory lock** (`pg_advisory_xact_lock(hashtext('suggest:' || account_id))`), so parallel sends cannot exceed it.
- **R4 Suggestion images get a column** `ingest_items.image_key` (store key `suggestions/<item id>/<uuid>.<ext>`), the draft's `image_url` is the store's public URL. Accept copies it to the event with `copyItemImage` and then deletes the suggestion object.
- **R5 Account deletion** (`deleteAccount`, in `packages/db`, which has no image store) sets pending suggestions to `withdrawn`; the cleanup job deletes images of withdrawn items on its next run (rejected ones after `SUGGESTION_IMAGE_KEEP_DAYS`).
- **R6 After "Send suggestion"** the web app goes to `/dashboard?suggested=1`, which shows the thanks message above "My suggestions".

## Review Focus

1. Two "Send suggestion" requests in parallel from an account with 4 sends today → exactly one succeeds (Task 2, `limit holds under parallel sends`).
2. A suggestion for an event that already ended → clear 400, not an item nobody ever sees (Task 2, `refuses an event that is over`).
3. Image or withdraw on another account's suggestion id → 404, never 403 (no existence leak) (Task 2, `another account's suggestion is not found`).
4. Edit & accept with an invalid edited event → 400 and the item stays pending (Task 3, `invalid edited event leaves the item pending`).
5. Withdraw racing an accept → one wins, the other gets 409; never an event from a withdrawn item (Task 3, `withdrawn items cannot be accepted`).

---

### Task 1: Schema, migration 0024 and account deletion

**Files:**
- Modify: `packages/db/src/schema.ts` (enums `ingestSourceKind`, `ingestItemStatus`; `ingestSources.accountId`; `ingestItems`)
- Create: `packages/db/migrations/0024_suggestions.sql` (+ drizzle meta via `pnpm --filter ./packages/db generate`, then hand-edit the SQL)
- Modify: `packages/db/src/accounts.ts` (`deleteAccount`)
- Modify: `packages/shared/src/ingest.ts` (`ingestItemStatusSchema`, source kind if mirrored there)
- Test: `packages/db/src/migrations.test.ts`, `packages/db/src/accounts.test.ts`

**Interfaces:**
- Produces: `ingestSourceKind` includes `'suggestion'`; `ingestItemStatus` includes `'withdrawn'`; `ingestItems.submittedBy: uuid | null` (FK accounts, cascade), `ingestItems.rejectReason: text | null`, `ingestItems.imageKey: text | null`; `ingestSources.accountId` nullable; constant `SUGGESTIONS_SOURCE_SLUG = 'suggestions'` exported from `@open-event-db/db`.

- [ ] **Step 1: Failing tests.** In `migrations.test.ts`: `it('0024 seeds exactly one suggestions source')` — after migrating, `select count(*) from ingest_sources where slug = 'suggestions' and kind = 'suggestion' and account_id is null` = 1, `official = false`; `it('a feed source still needs an account')` — inserting a kind `ical` source with `account_id` null fails with check violation `ingest_sources_account_required`. In `accounts.test.ts`: `it('deleteAccount withdraws pending suggestions and keeps decided ones')` — a pending and a rejected suggestion item of the account; after `deleteAccount` the pending one has status `withdrawn`, the rejected one is unchanged.
- [ ] **Step 2: Run** `DATABASE_URL=postgres://oedb:oedb@localhost:5432/oedb_regint pnpm --filter ./packages/db test` → the three tests fail.
- [ ] **Step 3: Implement.** Migration: `ALTER TYPE ingest_source_kind ADD VALUE 'suggestion'`; `ALTER TYPE ingest_item_status ADD VALUE 'withdrawn'` (both before any use, in their own statements with `--> statement-breakpoint`); `ALTER TABLE ingest_sources ALTER COLUMN account_id DROP NOT NULL` + `ADD CONSTRAINT ingest_sources_account_required CHECK (kind = 'suggestion' OR account_id IS NOT NULL)`; columns `submitted_by` (FK `accounts.id` on delete cascade), `reject_reason`, `image_key`; index `ingest_items_submitted_idx (submitted_by, first_seen_at)`; insert the source (slug `suggestions`, name `Suggestions`, kind `suggestion`, url `https://kellerkompass.de/`, official false, enabled true) `ON CONFLICT (slug) DO NOTHING`. `deleteAccount`: inside its transaction, `update ingest_items set status = 'withdrawn' where submitted_by = $id and status = 'pending'`. Fix every TypeScript use of `ingestSources.accountId` that now may be null (feed code paths assert non-null for non-suggestion sources).
- [ ] **Step 4: Run** the db tests and `pnpm -r typecheck` → green.
- [ ] **Step 5: Commit** `DB: suggestions source, withdrawn status and submitter columns (0024)`.

### Task 2: Suggestion routes for people

**Files:**
- Create: `packages/shared/src/suggestions.ts` (export from `index.ts`)
- Create: `packages/api/src/suggestions/draft.ts`, `packages/api/src/routes/suggestions.ts`
- Modify: `packages/api/src/app.ts` (register), `packages/api/src/routes/extract.ts` (guards)
- Test: `packages/api/src/routes/suggestions.test.ts`, `packages/api/src/routes/extract.test.ts`

**Interfaces:**
- Consumes: Task 1 columns and `SUGGESTIONS_SOURCE_SLUG`.
- Produces:
  - `suggestionCreateSchema = eventFieldsSchema` (no `organizer_id`, no `tags`, no `recurrence`) and `mySuggestionSchema = { id, title, starts_at, status: 'in_review' | 'live' | 'not_accepted', event_id: uuid | null, reason: string | null, image_url: string | null, created_at }` in shared; type `MySuggestion`.
  - `toSuggestionDraft(input: SuggestionCreateInput, venueCity: string | null): IngestDraft` in `suggestions/draft.ts`.
  - Routes `POST /suggestions`, `PUT|DELETE /suggestions/:id/image`, `DELETE /suggestions/:id`, `GET /accounts/me/suggestions` — all `onRequest: requireOnboarded`.
  - `suggestionImageKey(itemId: string, type: ImageType): string` → `suggestions/<itemId>/<uuid>.<ext>` in `images/store.ts`.

- [ ] **Step 1: Failing tests** in `suggestions.test.ts` (plain onboarded account, scout, second plain account):
  - `creates a pending item in the suggestions source` — 201, row has `submitted_by`, `external_id = id`, `status = 'pending'`, draft title/venue/links as sent.
  - `refuses an event that is over` — ended yesterday → 400 `event_over`.
  - `limit: the sixth suggestion of the day is refused` — 5 × 201, then 429 `suggestion_limit` with message "You've sent 5 suggestions today. Try again tomorrow."; with `SUGGESTIONS_PER_DAY=2` the third is refused.
  - `limit counts withdrawn suggestions`.
  - `limit holds under parallel sends` — 4 sent, then 3 parallel requests → exactly one 201.
  - `image upload and removal on an own pending suggestion` — PUT a PNG → `image_key` set, draft `image_url` = store URL; DELETE → both null, object deleted (memory store).
  - `another account's suggestion is not found` — PUT image / DELETE by the second account → 404.
  - `withdraw: own pending only` — 204 and status `withdrawn`, image deleted; on a rejected item → 409.
  - `my suggestions lists statuses` — pending → `in_review`; rejected with reason → `not_accepted` + reason; accepted → `live` + event id; linked (merged) → `live` + the linked event id; withdrawn not listed; newest first; header `Cache-Control: private, no-store`.
  - `POST /events stays closed to plain accounts` — 403.
  - `requires an onboarded account` — no session 401, non-onboarded 403 `onboarding_required`.
  In `extract.test.ts`: `a plain onboarded account may extract` (200 with the stubbed model) and `a non-onboarded account may not` (403).
- [ ] **Step 2: Run** `DATABASE_URL=… pnpm --filter ./packages/api exec vitest run src/routes/suggestions.test.ts src/routes/extract.test.ts` → fail.
- [ ] **Step 3: Implement.** City: from the venue when `venue_id` is given (404 `venue_not_found` if missing), else `city` required (400). Daily limit: count `submitted_by = me and first_seen_at > now() - 24h` (any status) inside the transaction after the advisory lock (R3). Image routes reuse the body parsing, `bodyLimit: EVENT_IMAGE_MAX_BYTES` and `sniffImageType` of `PUT /events/:id/image`; replacing deletes the old object. "Live" for a linked item: the item's `event_id`. Extract: replace `requireRights` with `requireOnboarded` on both routes.
- [ ] **Step 4: Run** the tests → pass; `pnpm -r typecheck` clean.
- [ ] **Step 5: Commit** `API: suggestions for every onboarded account`.

### Task 3: Inbox — submitter, edit & accept, reject reason, live mail

**Files:**
- Modify: `packages/shared/src/ingest.ts` (`ingestItemViewSchema`, accept/reject bodies)
- Modify: `packages/api/src/routes/ingest.ts`, `packages/api/src/ingest/run.ts`, `packages/api/src/email.ts`
- Test: `packages/api/src/routes/ingest.test.ts` (new `describe('suggestions in the inbox')`), `packages/api/src/email.test.ts`, `packages/api/src/ingest/run.test.ts`

**Interfaces:**
- Consumes: Task 1 columns; Task 2's items and `suggestionImageKey`.
- Produces:
  - `ingestItemViewSchema` gains `source.kind: string` and `submitter: { display_name, handle, accepted: number, decided: number } | null`; `image_url` of a suggestion is its draft `image_url`.
  - `ingestAcceptBodySchema = z.object({ event: eventFieldsSchema.optional() }).optional()`; `ingestRejectSchema` gains `reason: z.string().trim().max(500).optional()`.
  - `EmailTransport.sendEventLive(msg: { to: string; title: string; startsAt: string; url: string }): Promise<void>` (dev transport logs it, Scaleway sends it).

- [ ] **Step 1: Failing tests:**
  - `lists a suggestion with its submitter and record` — submitter with 2 accepted (one merged), 1 rejected, 1 pending, 1 withdrawn → `{ accepted: 2, decided: 3 }`; `source.kind = 'suggestion'`; first-time submitter → `{ accepted: 0, decided: 0 }`.
  - `a misfit suggestion stays in New` (R1) — `fit_verdict = 'no'` → in `view=new`, not in `view=filtered`, counted in `new`.
  - `withdrawn items are in no view and no count`.
  - `accept publishes a suggestion as created by the submitter` — event `created_by` = submitter, no organizer rows, history entry by the scout with `via: 'suggestion'`, suggestion image copied to the event and the suggestion object deleted.
  - `accept with an edited event publishes the edit` — body `{ event: { …, title: 'Fixed', venue_id } }` → event has the edited fields; works for a feed item too (creator stays the source account).
  - `invalid edited event leaves the item pending` — bad `starts_at` → 400, item still `pending`, no event.
  - `withdrawn items cannot be accepted` — 409.
  - `reject stores the reason` — single item with `reason` → `reject_reason` set; reason > 500 chars → 400.
  - `live mail on accept and on link, not on reject` — stub transport records `sendEventLive` to the submitter with the event URL `${WEB_URL}/events/<id>`; none for feed items.
  In `run.test.ts`: `the runner never fetches the suggestions source` (even with `only: ['suggestions']`). In `email.test.ts`: the live mail's text contains title, date and URL.
- [ ] **Step 2: Run** the three test files → fail.
- [ ] **Step 3: Implement.** `isNew`/`isFiltered`/counts treat items of kind `suggestion` as never filtered (join source kind). `isOpen` excludes `withdrawn` (it already requires `pending`; check). Submitter record: one grouped subquery per page keyed by `submitted_by`. Accept: parse the optional body before the transaction (400 leaves the item untouched); build the insert from the edited event when given, else from the draft; `createdBy = item.submittedBy ?? source.accountId`; `via` `'suggestion'` for suggestions. Images: suggestions → `copyItemImage` then delete `image_key` object and clear it; feeds → `syncItemImage` as today. Mail after commit via `email.transport.sendEventLive` in `void (async () => …)()` with logged errors; for link, the linked event. Runner: exclude `kind = 'suggestion'` in the source query regardless of `only`.
- [ ] **Step 4: Run** the full API suite (`DATABASE_URL=… pnpm --filter ./packages/api test`) → green.
- [ ] **Step 5: Commit** `API: suggestions in the inbox — submitter, edit & accept, reject reason, live mail`.

### Task 4: Cleanup of suggestion images

**Files:**
- Modify: `packages/api/src/cleanup.ts`
- Test: `packages/api/src/cleanup.test.ts`

**Interfaces:**
- Produces: `cleanupSuggestionImages(now = new Date()): Promise<number>`, called from the existing hourly cleanup next to `cleanupExpiredAuth`.

- [ ] **Step 1: Failing test** `it('deletes images of withdrawn suggestions now and of rejected ones after the keep period')` — withdrawn with image → deleted; rejected decided 31 days ago → deleted; rejected 29 days ago and pending → kept; `image_key` and draft `image_url` cleared for deleted ones; with `SUGGESTION_IMAGE_KEEP_DAYS=10` an 11-day-old one goes.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement** with the memory/real store via `imageStore.store`; a failed delete is logged and retried next run (key kept).
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `API: clean up suggestion images`.

### Task 5: Web — suggesting and My suggestions

**Files:**
- Modify: `packages/web/src/app/events/new/page.tsx`, `packages/web/src/components/NewEventForm.tsx`, `packages/web/src/components/EventForm.tsx`, `packages/web/src/components/VenuePicker.tsx`, `packages/web/src/components/Header.tsx`, `packages/web/src/components/ListToolbar.tsx`, `packages/web/src/app/dashboard/page.tsx`, `packages/web/src/lib/permissions.ts`, `packages/web/src/lib/api.ts`
- Create: `packages/web/src/components/MySuggestions.tsx`
- Test: `packages/web/src/lib/permissions.test.ts`

**Interfaces:**
- Consumes: Task 2 routes and `MySuggestion`.
- Produces: `canSuggestEvents(me): boolean` (onboarded and not `canCreateEvents(me)`); `EventForm` prop `mode: 'create' | 'edit' | 'suggest' | 'accept'`; `VenuePicker` prop `allowCreate?: boolean` (default true).

- [ ] **Step 1: Failing test** in `permissions.test.ts`: `canSuggestEvents` true for a plain onboarded account, false for a scout, a verified-organizer member, and null.
- [ ] **Step 2: Run** `pnpm --filter ./packages/web test` → fail.
- [ ] **Step 3: Implement.**
  - Header user menu and list toolbar: "Suggest event" → `/events/new` for `canSuggestEvents`; the toolbar shows it logged out too, linking to `/login?return_to=/events/new`.
  - `/events/new`: plain accounts get headline "Suggest event", `NewEventForm` in suggest mode (flyer import stays); the "can't create events yet" notice goes.
  - `EventForm` suggest mode: no publish-as select, `VenuePicker allowCreate={false}` (place text + city instead), the exact hint above the button, button "Send suggestion"; submit `POST /suggestions`, then the image via `PUT /suggestions/:id/image`, then `router.push('/dashboard?suggested=1')` (R6). A 429 shows the API message and keeps the form.
  - `/dashboard`: `MySuggestions` (server-fetched `GET /accounts/me/suggestions`) with the thanks message when `?suggested=1`; rows: title, date, "In review" + Withdraw (native confirm, `DELETE /suggestions/:id`, refresh), "Live" + link, "Not accepted" + reason; empty state "No suggestions yet." with a "Suggest event" link. Shown for every onboarded account that has suggestions or `canSuggestEvents`.
- [ ] **Step 4: Run** web tests and `pnpm -r typecheck` → green.
- [ ] **Step 5: Commit** `Web: suggest events and My suggestions`.

### Task 6: Web — inbox suggestions, edit & accept, reject reason

**Files:**
- Modify: `packages/web/src/components/IngestItemCard.tsx`, `packages/web/src/components/IngestInbox.tsx`, `packages/web/src/components/IngestSourceFilter.tsx`, `packages/web/src/components/EventForm.tsx`
- Create: `packages/web/src/app/ingest/[id]/edit/page.tsx`
- Test: `packages/web/src/lib/ingest-submitter.test.ts` (with a small `submitterLine(submitter)` helper in `packages/web/src/lib/ingest-submitter.ts`)

**Interfaces:**
- Consumes: Task 3 view fields and accept/reject bodies; Task 5 `EventForm` modes.
- Produces: `submitterLine(s: { display_name: string; handle: string; accepted: number; decided: number }): string`.

- [ ] **Step 1: Failing test:** `submitterLine` → "Suggested by Maria (@maria) · 4 of 5 accepted"; with `decided: 0` → "Suggested by Maria (@maria) · first suggestion".
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.**
  - Card: for `source.kind === 'suggestion'` the submitter line replaces the source name; the suggestion image shows like a feed image.
  - Every card gets **Edit & accept** → `/ingest/items/<id>/edit` (scouts only): `EventForm` in accept mode, pre-filled from the draft (venue, image preview), venue creation allowed; "Publish" → `POST /ingest/items/:id/accept` with `{ event }`, then the image change against `/events/:id/image` (keep → none), then `/events/<id>`; "Cancel" → back to `/ingest`; 409 → "Someone else decided this item meanwhile."
  - Reject on a single suggestion: an inline optional textarea "Reason (shown to the person)" (max 500) before confirming; bulk reject unchanged.
  - Source filter shows the "Suggestions" source like any other.
- [ ] **Step 4: Run** web tests, typecheck.
- [ ] **Step 5: Commit** `Web: suggestions in the inbox, edit & accept, reject reason`.

### Task 7: Legal texts, release notes, browser check

**Files:**
- Modify: `packages/web/src/content/legal/datenschutz.ts`, `packages/web/src/content/legal/nutzungsbedingungen.ts`, `packages/web/src/content/legal/operator.ts` (`LEGAL_UPDATED`)
- Modify: `DEPLOY.md` (new section "Release: suggestions")

- [ ] **Step 1:** Datenschutz: a section on suggestions (stored: content, optional image, who suggested, optional rejection reason; images of rejected or withdrawn suggestions deleted after 30 days resp. at once; on acceptance the display name is public as "Added by"; basis Art. 6 Abs. 1 lit. b). Nutzungsbedingungen: anyone with an account may suggest; no right to publication; uploaded images and texts must not infringe third-party rights; we may edit before publishing. German, in the existing style. **Do not commit these files — the owner approves them first;** leave them modified and list the changes in the report.
- [ ] **Step 2:** DEPLOY.md: migration 0024 is additive; env `SUGGESTIONS_PER_DAY`, `SUGGESTION_IMAGE_KEEP_DAYS`; post-deploy checks (suggest as a plain account, see it in the inbox with the submitter line, edit & accept, mail arrives, reject with reason shows in My suggestions, withdraw).
- [ ] **Step 3:** Full suite `DATABASE_URL=… pnpm test` and `pnpm -r typecheck` → green.
- [ ] **Step 4: Commit** `Docs: release notes for suggestions` (DEPLOY.md only).
