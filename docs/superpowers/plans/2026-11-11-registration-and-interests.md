# Open Registration and Interests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can sign up through the login form, finish a one-time onboarding, manage their email and delete their account; every account can mark events as interested, filter the feed to them and subscribe to them as an iCal calendar.

**Architecture:** One additive migration (account flags, token kinds, `event_interests`). The API extends the existing magic-link flow with sign-up and email-change token kinds and a safe `return_to`; account self-service and interests are new routes; the calendar is a token-addressed `.ics` route with a small RFC 5545 serializer. The web app gates not-yet-onboarded accounts to `/welcome` from the root layout and adds the interest toggle, the "Only mine" filter and the calendar panel to the existing feed.

**Tech Stack:** Postgres 16, Drizzle ORM 0.36 / drizzle-kit 0.30, Fastify, Zod, Next.js 15 (App Router), Vitest, pnpm, Node 24.

**Spec:** `docs/superpowers/specs/2026-11-11-registration-and-interests-design.md` — read it first; this plan does not repeat its behavior descriptions. Background: `docs/superpowers/specs/2026-11-11-accounts-and-organizers-design.md` (step 1, live).

## Global Constraints

- Magic-link response body and timing stay identical for known and unknown addresses (send in the background, as today).
- Rate limits: magic link 3/h per email (existing); sign-up mails for unknown addresses max **10 per IP per day**; iCal **60/h per token**; interest PUT/DELETE use `writeRateLimit`.
- `return_to`: accepted only if it starts with `/`, does not start with `//`, contains no `\`, and is at most **500** chars; otherwise dropped silently.
- Provisional handle on sign-up: `new-` + 8 random lowercase alphanumerics. Handle pre-fill from display name: lowercase, `ä→ae ö→oe ü→ue ß→ss`, other diacritics stripped, runs of non-`[a-z0-9]` → `-`, trimmed of `-`, max **40** chars, fallback `user` when empty.
- Display name 1–60 chars, trimmed.
- Token validity: login and sign-up links 15 min (existing); email-change links **24 h**.
- Calendar token: 32 random bytes, base64url, stored in plain text in `accounts.calendar_token` (unique).
- Interest counts never appear in any public API response or web page; only `pnpm db:cli interest-stats`.
- `interested` on event detail only for authenticated requests; absent otherwise.
- "Only mine" past section and calendar window: **90 days** back.
- iCal: `UID:<event id>@kellerkompass.de`; timed events without end → +4 h; unknown start time → all-day `VALUE=DATE`; `STATUS:CANCELLED` for cancelled; title prefix `Postponed: ` for postponed; `X-WR-CALNAME:Kellerkompass – My events`; `REFRESH-INTERVAL;VALUE=DURATION:PT1H`; lines folded at 75 octets; `DESCRIPTION` = first 500 chars of the plain-text description + newline + event URL.
- User-visible app copy is English; legal texts German. Legal texts are left uncommitted for the owner's approval (as in step 1).
- Work in this worktree on branch `worktree-registration-interests-spec`; use a branch database `oedb_regint` (`DATABASE_URL=postgres://oedb:oedb@localhost:5432/oedb_regint`), never the shared `oedb`; never `pnpm db:down/up` (shared container `open-event-db-postgres-1`).
- No new runtime dependencies.

## Review Focus

1. **Two sign-up links for the same address clicked (both, or in two tabs)** → exactly one account; the second click logs into it. Test in Task 3.
2. **An onboarded person opening an old sign-up link after deleting their account** → a fresh account is created (the email is free again), never a 500. Test in Task 3.
3. **Email change to an address someone else registered in the meantime** → the confirm click shows "already in use", nothing changes. Test in Task 4.
4. **Marking an event that is later hard-deleted** (`delete-event`) → the interest row disappears (cascade), feed and calendar don't break. Test in Task 5.
5. **Calendar app polling after "New link"** → old URL 404 immediately; new URL works. Test in Task 6.

---

### Task 1: Schema and migration 0023

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/0023_registration_interests.sql` (generated, then checked), snapshot + journal
- Test: `packages/db/src/migrations.test.ts` (extend)

**Interfaces:**
- Produces: `accounts.onboardedAt` (timestamptz null), `accounts.termsAcceptedAt` (timestamptz null), `accounts.calendarToken` (text unique null); `magicLinkTokens.accountId` nullable, `magicLinkTokens.email` (text not null), `magicLinkTokens.kind` (enum `magic_link_kind` = `login | signup | email_change`, default `login`), `magicLinkTokens.returnTo` (text null), `magicLinkTokens.newEmail` (text null), `magicLinkTokens.requestIp` (text null; set for sign-up tokens, for the per-IP cap), index on (`kind`, `request_ip`, `created_at`) — add `magicLinkTokens.createdAt` (timestamptz not null default now()) if the table has none; table `eventInterests { accountId, eventId, createdAt }` pk (accountId, eventId), index on eventId, both FKs `on delete cascade`; types `EventInterest`, `NewEventInterest`.

- [ ] **Step 1: Write the failing migration test** — in `migrations.test.ts`, migrate a scratch DB to 0022, insert an account and a magic-link token for it, migrate to head, assert: `onboarded_at = created_at` for the account; the token has `email` = the account's email and `kind = 'login'`; inserting a token with `account_id null, kind 'signup'` works; deleting an event removes its `event_interests` rows; deleting an account removes its interests.
- [ ] **Step 2: Run** `npx vitest run packages/db/src/migrations.test.ts` → FAIL (column `onboarded_at` does not exist).
- [ ] **Step 3: Update `schema.ts`** with the Interfaces above.
- [ ] **Step 4: Generate** `pnpm --filter ./packages/db exec drizzle-kit generate --name registration_interests` (additive only, no rename prompt expected). Then hand-edit the SQL: add the backfills between the column adds and the `NOT NULL`: `UPDATE accounts SET onboarded_at = created_at;` and `UPDATE magic_link_tokens t SET email = a.email FROM accounts a WHERE a.id = t.account_id;` — so `email` must be added nullable, backfilled, then `SET NOT NULL` (and delete orphan tokens without account first: `DELETE FROM magic_link_tokens WHERE account_id IS NULL;`).
- [ ] **Step 5: Run** the migration test → PASS; `pnpm --filter ./packages/db exec drizzle-kit generate --name should_be_empty` → "No schema changes".
- [ ] **Step 6: Commit** `DB: onboarding, token kinds and event interests`.

### Task 2: Shared deletion and CLI

**Files:**
- Create: `packages/db/src/accounts.ts` (export from `packages/db/src/index.ts`)
- Modify: `packages/db/src/cli.ts`
- Test: `packages/db/src/accounts.test.ts`

**Interfaces:**
- Produces: `deleteAccount(db: Db, accountId: string): Promise<{ orphanedOrganizers: { id: string; name: string; slug: string }[]; eventCount: number }>` — exactly today's `delete-account` effect (see `cli.ts` case `delete-account`) plus deleting the account's `event_interests` and setting `calendar_token = null`, `onboarded_at`/`terms_accepted_at` kept; one transaction. `soleMemberships(db: Db, accountId: string): Promise<{ id: string; name: string; slug: string }[]>` — organizers where this account is the only member (used before confirming).
- CLI: `delete-account` uses both; new `interest-stats [--upcoming] [--limit N]` (default limit 20) printing `count  starts_at  title  (event id)` sorted by count desc.

- [ ] **Step 1: Write failing tests** in `accounts.test.ts` (against `oedb_regint`): after `deleteAccount`, the account has handle `deleted-<id>`, no sessions, no tokens, no memberships, no interests, `calendar_token` null, its events still exist with `created_by` unchanged; `orphanedOrganizers` lists an organizer whose only member it was and not one with another member.
- [ ] **Step 2: Run** `npx vitest run packages/db/src/accounts.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** the two functions by moving the CLI logic; make the CLI call them (prompt text unchanged).
- [ ] **Step 4: Verify** the test passes; run `pnpm db:cli interest-stats` on the seeded branch DB → prints a header and "No interests yet."; `pnpm --filter ./packages/db typecheck` clean.
- [ ] **Step 5: Commit** `DB: shared account deletion, interest-stats CLI`.

### Task 3: Shared schemas and sign-up through the magic link

**Files:**
- Modify: `packages/shared/src/accounts.ts`, `packages/shared/src/events.ts`
- Create: `packages/shared/src/handle.ts` (+ export), `packages/shared/src/handle.test.ts`, `packages/shared/src/return-to.ts`, `packages/shared/src/return-to.test.ts`
- Modify: `packages/api/src/routes/auth.ts`, `packages/api/src/email.ts`, `packages/api/src/auth.ts` (AccountMe `onboarded`)
- Test: `packages/api/src/routes/auth.test.ts`, `packages/api/src/email.test.ts`

**Interfaces:**
- Produces (shared): `handleFromName(name: string): string` (rules in Global Constraints); `safeReturnTo(value: unknown): string | null`; `magicLinkRequestSchema` gains optional `return_to`; `accountMeSchema` gains `onboarded: boolean` and `has_calendar: boolean`; `onboardingSchema { display_name, handle, accept_terms: z.literal(true) }`; `emailChangeSchema { email }`; `deleteAccountSchema { confirm_handle }`; `interestIdsResponseSchema { data: { event_ids: string[] } }`; `eventListQuerySchema` gains `mine: z.coerce.boolean().optional()`; event detail gains optional `interested: boolean`.
- Produces (API email): `EmailTransport` gets `sendMagicLink({ to, url, kind: 'login' | 'signup' | 'email_change' })` and `sendEmailChangedNotice({ to, newEmail })`; subjects: login "Your Kellerkompass login link", signup "Confirm your email to join Kellerkompass", email_change "Confirm your new Kellerkompass email" (valid 24 hours), notice "Your Kellerkompass email was changed".
- Produces (API auth): `POST /auth/magic-link` with unknown address → token `kind 'signup'`, `account_id null`, `email` normalized, `return_to` stored; known address → `kind 'login'`; the per-IP sign-up cap: before creating a sign-up token, count `magic_link_tokens` with `kind = 'signup'`, `request_ip = req.ip`, `created_at > now() - 24h`; at 10 or more, create and send nothing (response unchanged). `packages/api/src/cleanup.ts` deletes expired/used tokens today, which would empty the count after 15 minutes: change it to keep `signup` tokens until `created_at` is older than 24 h (other kinds as before), with a test in `packages/api/src/routes/auth.test.ts` or a cleanup test. `GET /auth/verify` handles `signup` per spec A.1 and redirects to `token.return_to ?? '/dashboard'` on `WEB_URL`; `email_change` tokens are handled in Task 4.

- [ ] **Step 1: Write failing tests**
  - `handle.test.ts`: `handleFromName('Mia Köhler')==='mia-koehler'`, `('  DJ  Straße!! ')==='dj-strasse'`, `('Ñoño')==='nono'`, `('!!!')==='user'`, 41+ char input → length 40 without trailing `-`.
  - `return-to.test.ts`: `'/events/x?interest=1'` kept; `'//evil.example'`, `'https://evil.example'`, `'/\\evil'`, `'events'`, 501-char path → `null`.
  - `auth.test.ts`: unknown email → 200 same body as known, outbox gets a signup mail, no account yet; clicking it creates one account with `handle` matching `/^new-[a-z0-9]{8}$/`, `onboarded:false` on `/auth/me`, redirect to `return_to`; two signup tokens for one address → clicking both yields one account and two sessions on it; signup link for an address whose account was deleted earlier (`deleteAccount`) creates a fresh account; `return_to: '//evil.example'` → redirect to `/dashboard`; 11th signup mail from one IP in a day is not sent (response unchanged).
- [ ] **Step 2: Run** `npx vitest run packages/shared packages/api/src/routes/auth.test.ts` → FAIL.
- [ ] **Step 3: Implement** shared helpers/schemas, email kinds, magic-link + verify changes.
- [ ] **Step 4: Run** the same command → PASS; `pnpm typecheck` clean.
- [ ] **Step 5: Commit** `API: sign-up through the magic link, safe return_to`.

### Task 4: Account self-service API

**Files:**
- Modify: `packages/api/src/routes/accounts.ts`, `packages/api/src/routes/auth.ts` (verify `email_change`)
- Test: `packages/api/src/routes/accounts.test.ts` (create)

**Interfaces:**
- Consumes: Task 2 `deleteAccount`, `soleMemberships`; Task 3 schemas and email kinds.
- Produces: `POST /accounts/me/onboarding` (session only) → 200 AccountMe; 400 `handle_taken`, 400 `terms_required`; 409 `already_onboarded`. `POST /accounts/me/email` (session only) → 200 `{ data: { sent: true } }` always (no "taken" leak); token kind `email_change`, `new_email` set, 24 h. Verify of `email_change`: if `new_email` is free → update, send notice to old address, redirect `/profile?email=changed`; else redirect `/profile?email=taken`. `GET /accounts/me/delete-preview` → `{ data: { orphaned_organizers: [{ id, name, slug }] } }`. `DELETE /accounts/me` (session only) body `deleteAccountSchema`; wrong handle → 400 `confirm_mismatch`; success → 200, cookie cleared. `POST /accounts/me/calendar-token` (session only) → `{ data: { url: string } }` with `url = ${API_PUBLIC_URL}/cal/<token>.ics`, rotating if one exists. `GET /accounts/me/calendar` → `{ data: { url: string | null } }`.

- [ ] **Step 1: Write failing tests** for every route above incl.: onboarding sets `onboarded_at` and `terms_accepted_at`; `accept_terms:false` → 400 `terms_required`; email change to a taken address → response `sent:true`, confirm click redirects `?email=taken` and nothing changes; free address → changed, notice mail to old address in outbox; delete with wrong handle → 400; delete success → sessions gone, `/auth/me` 401 with the old cookie; calendar-token twice → different URLs.
- [ ] **Step 2: Run** `npx vitest run packages/api/src/routes/accounts.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `API: onboarding, email change, self-deletion, calendar token`.

### Task 5: Interests API

**Files:**
- Create: `packages/api/src/routes/interests.ts` (register in `app.ts` under `/api/v1`)
- Modify: `packages/api/src/routes/events.ts` (list `mine`, detail `interested`), `packages/api/src/queries/events.ts`
- Test: `packages/api/src/routes/interests.test.ts`

**Interfaces:**
- Produces: `PUT /events/:id/interest`, `DELETE /events/:id/interest` (requireAuth, writeRateLimit; 204; 404 unknown event; idempotent); `GET /accounts/me/interests?from=&to=` → `{ data: { event_ids } }` (requireAuth); `GET /events?mine=true` (401 without auth; combinable with all filters and cursor); detail `interested` only when `req.account` is set.

- [ ] **Step 1: Write failing tests**: put twice → one row; delete twice → 204 both; unknown id → 404; `mine=true` anonymous → 401; `mine=true&q=…` returns only marked matching events; detail anonymous has no `interested` key, authenticated has `true/false`; `JSON.stringify` of list and detail responses (anonymous and authenticated) contains neither `interest_count` nor any numeric count field (assert keys equal the schema's keys); hard-deleting a marked event (`db.delete(events)`) leaves no interest rows and `GET /accounts/me/interests` still 200.
- [ ] **Step 2: Run** `npx vitest run packages/api/src/routes/interests.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; full `npx vitest run packages/api` green.
- [ ] **Step 5: Commit** `API: event interests and the mine filter`.

### Task 6: iCal feed

**Files:**
- Create: `packages/api/src/ical.ts`, `packages/api/src/ical.test.ts`, `packages/api/src/routes/calendar.ts` (registered at the root, not under `/api/v1`, path `/cal/:token.ics`)
- Test: `packages/api/src/routes/calendar.test.ts`

**Interfaces:**
- Produces: `toICalendar(events: CalendarEvent[], opts: { now: Date; webUrl: string }): string` where `CalendarEvent = { id, title, descriptionPlain, startsAt: Date, startTimeKnown: boolean, endsAt: Date | null, status: 'scheduled'|'cancelled'|'postponed', location: string | null, createdAt: Date, updatedAt: Date }`; route returns `text/calendar; charset=utf-8`, `Cache-Control: private, max-age=300`.

- [ ] **Step 1: Write failing tests** (`ical.test.ts`): output starts `BEGIN:VCALENDAR\r\n`, uses CRLF; timed event without end → `DTEND` 4 h after `DTSTART` in `YYYYMMDDTHHMMSSZ`; unknown start time → `DTSTART;VALUE=DATE:` with the Berlin date; cancelled → `STATUS:CANCELLED`; postponed → `SUMMARY:Postponed: …`; commas/semicolons/newlines escaped (`\,` `\;` `\n`); a 200-char title is folded into lines ≤ 75 octets (UTF-8, multi-byte chars not split); `UID:<id>@kellerkompass.de`. (`calendar.test.ts`): unknown token → 404; after `POST /accounts/me/calendar-token` again the old token → 404 and the new one → 200 listing the marked events from 90 days back; 61st request within an hour → 429.
- [ ] **Step 2: Run** `npx vitest run packages/api/src/ical.test.ts packages/api/src/routes/calendar.test.ts` → FAIL.
- [ ] **Step 3: Implement**, including `stripMarkdown(md: string): string` in `ical.ts` (the web's `markdownToPlainText` depends on `mdast`, which the API doesn't have, and no new dependency is allowed): `[text](url)` → `text`, drop `**`, `*`, `_`, leading `#`s, backticks, `> `; collapse blank-line runs. Add `ical.test.ts` cases: `'**Doors** 22:00, [Tickets](https://x)'` → `'Doors 22:00, Tickets'`.
- [ ] **Step 4: Run** → PASS. Import the generated file once into Apple Calendar or validate with an online RFC 5545 validator copy saved under the scratchpad — note the result in the report.
- [ ] **Step 5: Commit** `API: iCal feed of marked events`.

### Task 7: Web — login, welcome, account settings

**Files:**
- Modify: `packages/web/src/middleware.ts` (set request header `x-pathname`), `packages/web/src/app/layout.tsx` (onboarding gate), `packages/web/src/app/login/page.tsx`, `packages/web/src/components/LoginForm.tsx` (`returnTo` prop), `packages/web/src/components/Header.tsx`, `packages/web/src/components/UserMenu.tsx` (My events), `packages/web/src/app/profile/page.tsx`, `packages/web/src/components/AccountForm.tsx`
- Create: `packages/web/src/app/welcome/page.tsx`, `packages/web/src/components/WelcomeForm.tsx`, `packages/web/src/components/EmailChangeForm.tsx`, `packages/web/src/components/DeleteAccountSection.tsx`, `packages/web/src/app/goodbye/page.tsx`, `packages/web/src/lib/onboarding.ts` + test

**Interfaces:**
- Consumes: Tasks 3–4 endpoints, `handleFromName`, `safeReturnTo`.
- Produces: `needsWelcome(pathname: string, me: AccountMe | null): boolean` in `lib/onboarding.ts` — true iff `me && !me.onboarded` and the path is not `/welcome`, `/goodbye`, `/impressum`, `/datenschutz`, `/nutzungsbedingungen`, `/lizenz` or under `/_next`; `LoginForm` prop `returnTo?: string`.
- Copy: header link "Log in"; login page "Log in or sign up — we'll email you a link."; welcome heading "Welcome to Kellerkompass"; checkbox label "I accept the [Terms of Use](/nutzungsbedingungen) and have read the [Privacy Policy](/datenschutz)."; delete section heading "Delete account"; goodbye "Your account is deleted. Thanks for being here."

- [ ] **Step 1: Write failing tests** `lib/onboarding.test.ts` (cases above, incl. onboarded → false, null → false).
- [ ] **Step 2: Run** `npx vitest run packages/web/src/lib/onboarding.test.ts` → FAIL.
- [ ] **Step 3: Implement** the helper, gate (`redirect('/welcome?return_to=' + encodeURIComponent(path))`), pages and components. WelcomeForm: handle follows `handleFromName(displayName)` until the handle input is edited; live check via `/accounts/check-handle` (existing debounce pattern from `AccountForm`); submit disabled until checkbox ticked. Profile: email-change form shows `?email=changed|taken` result; delete section loads delete-preview, lists orphaned organizers, enables the button only when the typed text equals the handle.
- [ ] **Step 4: Verify** `pnpm --filter ./packages/web typecheck`, `npx vitest run packages/web`; then in the browser (controller): unknown email → console link → `/welcome` → finish → `return_to`; email change both outcomes; delete → `/goodbye`, logged out.
- [ ] **Step 5: Commit** `Web: sign-up, welcome, email change and account deletion`.

### Task 8: Web — interests, Only mine, calendar

**Files:**
- Create: `packages/web/src/components/InterestToggle.tsx` (client), `packages/web/src/components/InlineLogin.tsx` (client sheet), `packages/web/src/components/CalendarPanel.tsx` (client), `packages/web/src/components/InterestFromLogin.tsx` (client, handles `?interest=1`)
- Modify: `packages/web/src/components/EventRow.tsx` (optional `interested?: boolean | null` prop → toggle; `null` = logged out), `packages/web/src/components/EventList.tsx`, `packages/web/src/app/page.tsx`, `packages/web/src/app/events/[id]/page.tsx`, `packages/web/src/components/ListToolbar.tsx`, `packages/web/src/lib/filters.ts` (+ test), `packages/web/src/lib/api.ts`

**Interfaces:**
- Consumes: Task 5 endpoints, Task 4 calendar endpoints, Task 7 `LoginForm returnTo`.
- Produces: `Filters.mine?: boolean`, parsed from `mine=1`, kept by `filtersToHref`, mapped by `buildApiQuery` to `mine=true`; `getInterestIds(cookie: string, from?: Date, to?: Date): Promise<Set<string>>` in `lib/api.ts`.
- Copy: toggle aria-label "Interested" / "Remove from My events"; toast "Saved to My events"; toolbar toggle "Only mine"; empty state "Nothing saved yet. Tap ☆ on an event to keep it here and in your calendar."; past section "Past"; calendar button "Add to calendar", rotate button "New link" with confirm "The old link stops working in your calendar apps. Continue?".

- [ ] **Step 1: Write failing tests** in `lib/filters.test.ts`: `parseFilters({ mine: '1' }).mine === true`; `filtersToHref({ ...f, mine: true })` contains `mine=1`; `buildApiQuery({ ...f, mine: true }).get('mine') === 'true'`; without `mine` nothing is added.
- [ ] **Step 2: Run** `npx vitest run packages/web/src/lib/filters.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Feed page: when logged in, one `getInterestIds` call for the shown range and pass `interested` per row; with `mine`, a second query for the past 90 days (`to=now, order=desc, mine=true`) rendered collapsed under "Past". Logged-out toggle opens `InlineLogin` with `returnTo=/events/<id>?interest=1`. Event page renders `InterestFromLogin`, which on `interest=1` calls PUT, shows the toast and `router.replace` without the parameter.
- [ ] **Step 4: Verify** typecheck + web tests; browser (controller): logged-out toggle → inline login → console link → (welcome) → event marked; Only mine with search and a date range; Past section; calendar URL opens and lists the event; New link → old URL 404.
- [ ] **Step 5: Commit** `Web: interests, Only mine and calendar subscription`.

### Task 9: Legal texts, docs, sweep

**Files:**
- Modify (leave uncommitted for the owner): `packages/web/src/content/legal/datenschutz.ts`, `packages/web/src/content/legal/nutzungsbedingungen.ts`
- Modify: `DEPLOY.md` (release section: no snapshot ceremony needed — additive migration; after deploy: sign up with a fresh address on production and run the full path), `.env.example` if a new variable was added

- [ ] **Step 1: Draft the legal changes** per spec A.6 in German, short, in the existing tone; put the full diff into the report.
- [ ] **Step 2: Docs** as listed.
- [ ] **Step 3: Verify** `pnpm typecheck && npx vitest run` whole repo green.
- [ ] **Step 4: Commit** everything except the two legal files: `Docs: release notes for registration and interests`.

### Task 10: Release check (controller + owner)

No code. After the owner approves the legal diff and the final review: fast-forward `main`, push (deploy). Then on production: sign up with a fresh address (owner's mailbox), finish `/welcome`, mark an event, "Only mine", subscribe the calendar in the owner's calendar app, change and change back the email, delete the test account. Report results.
