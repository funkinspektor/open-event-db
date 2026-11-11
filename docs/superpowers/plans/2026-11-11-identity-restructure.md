# Identity Restructure (Accounts & Organizers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the `publishers` table into accounts (people who log in) and organizers (public group profiles with members), and rename everything that says "publisher" — schema, API, CLI, web app — without changing what anyone can do.

**Architecture:** One hand-written SQL migration copies publishers into `accounts` and `organizers` **keeping their ids**, so every foreign key stays valid and sessions survive. Permissions move from "owner = publisher" to "owner = organizer, actor = account + its verified organizer ids", in the shared permission module that both API and web use. API and web ship together in one deploy.

**Tech Stack:** Postgres 16, Drizzle ORM 0.36 / drizzle-kit 0.30, Fastify, Zod, Next.js 15, Vitest, pnpm workspaces, Node 24.

**Spec:** `docs/superpowers/specs/2026-11-11-accounts-and-organizers-design.md` — section "Step 1: Identity restructure". Read it first; this plan does not repeat its tables.

## Global Constraints

- No new behavior: every flow that works today works the same afterwards; nobody gains a right they don't have today.
- Ids are preserved: `accounts.id` = old `publishers.id`; `organizers.id` = old `publishers.id` for publishers with `is_publisher`.
- The migration renames; it never drops and recreates a table that holds data (`event_owners`, `sessions`, `edit_history`, …).
- Public API stays under `/api/v1`, renamed in place (spec 1.4).
- No user-visible "publisher" remains except the `/publishers/:slug` → `/organizers/:slug` permanent redirect.
- Enum values: `organizer_member_role` = `owner | member`; `event_organizer_role` = `creator | co_host`; `edit_history_entity_type` = `event | venue | account | organizer`.
- Error codes introduced: 400 `organizer_required`, 403 `not_a_member`, 400 `handle_taken`, 400 `slug_taken` (existing).
- Work in the worktree, fast-forward into `main` only after Task 9 (memory: worktree per session, push deploys).
- Run tests from the repo root with the local DB up and migrated: `pnpm db:up && pnpm db:migrate`, then `npx vitest run <path>`.
- Between Task 1 and the end of Task 5 the API does not typecheck and test files of later tasks fail; each task runs only its own listed tests. Full `pnpm typecheck && npx vitest run` must be green from Task 5 (API) and Task 8 (everything) on.

## Review Focus

1. **A scout who is also an organizer member creates an event without `organizer_id`** → it is unclaimed, not silently owned by their collective. Test in Task 4.
2. **A member of an unverified organizer** (possible after migration if a publisher was unverified) → can log in but can neither create nor edit events. Test in Task 3 (auth) and Task 4 (events).
3. **An account in two verified organizers creates an event without `organizer_id`** → 400 `organizer_required`; with someone else's organizer id → 403 `not_a_member`. Test in Task 4.
4. **An existing session cookie after the migration** → still authenticates as the same person (ids kept). Test in Task 1 (session row survives with same id/account) and checked live in Task 9.
5. **Old shared link `/publishers/<slug>`** → permanent redirect to `/organizers/<slug>`, not a 404. Checked in Task 7.

---

### Task 1: Schema and migration

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/0022_accounts_organizers.sql`, `packages/db/migrations/meta/0022_snapshot.json`; Modify: `packages/db/migrations/meta/_journal.json`
- Test: `packages/db/src/migrations.test.ts`

**Interfaces:**
- Produces (exported from `@open-event-db/db`): tables `accounts`, `organizers`, `organizerMembers`, `eventOrganizers`; enums `organizerMemberRole`, `eventOrganizerRole`, `editHistoryEntityType`; types `Account`, `NewAccount`, `Organizer`, `NewOrganizer`, `OrganizerMember`, `EventOrganizer`. Column names (TS): `accounts.{id,email,handle,displayName,isScout,apiKeyHash,createdAt,updatedAt}`, `organizers.{id,name,slug,links,verified,createdAt,updatedAt}`, `organizerMembers.{organizerId,accountId,role}`, `eventOrganizers.{eventId,organizerId,role}`, `sessions.accountId`, `magicLinkTokens.accountId`, `editHistory.accountId`, `ingestSources.accountId`; `events.createdBy` and `ingestItems.decidedBy` now reference `accounts`.
- Removed: `publishers`, `invites`, `eventOwners`, `eventOwnerRole`, types `Publisher*`, `Invite*`, `EventOwner*`.

- [ ] **Step 1: Write the failing migration test**

The test creates a scratch database, migrates it to 0021 with a copy of the migrations folder whose journal is cut after idx 21, inserts old-schema rows with raw SQL, then migrates with the real folder.

Helper inside the test file: `async function scratchDb(): Promise<{ sql: postgres.Sql; url: string; drop: () => Promise<void> }>` — connects to `DATABASE_URL` (default `postgres://oedb:oedb@localhost:5432/oedb`), `CREATE DATABASE oedb_mig_<random>`, returns a client for it; `drop` ends the client and `DROP DATABASE … WITH (FORCE)`. Helper `async function migrateTo(url: string, upToIdx: number | null)` — copies `packages/db/migrations` into an `fs.mkdtemp` folder, truncates `meta/_journal.json` entries to `idx <= upToIdx` when given, runs `migrate(drizzle(client), { migrationsFolder })` from `drizzle-orm/postgres-js/migrator`.

Fixtures inserted at 0021 (raw SQL, fixed uuids):
- publisher `org` (verified, is_publisher, slug `org-a`, name `Org A`, links `{"website":"https://a.example"}`, api_key_hash `h1`)
- publisher `scout` (verified, is_publisher false, is_scout true, slug `scout-s`)
- publisher `ghost` (verified **false**, is_publisher false, is_scout true, slug `ghost`)
- publisher `co` (verified, is_publisher, slug `org-b`)
- venue, one event created by `scout` with `event_owners` rows (`org`, creator) and (`co`, co_owner); a second event created by `scout` without owners
- a session and a magic link token for `org`; edit_history rows with entity_type `publisher` and `event` by `org`; an ingest source attributed to `scout` with one item `decided_by` `scout`

```ts
it('splits publishers into accounts and organizers, keeping ids', async () => {
  // after migrateTo(url, null)
  expect(await sql`select id, handle, display_name, is_scout, api_key_hash from accounts order by handle`).toEqual([
    { id: CO, handle: 'org-b', display_name: 'Org B', is_scout: false, api_key_hash: null },
    { id: GHOST, handle: 'ghost', display_name: 'Ghost', is_scout: false, api_key_hash: null }, // unverified scout loses the flag
    { id: ORG, handle: 'org-a', display_name: 'Org A', is_scout: false, api_key_hash: 'h1' },
    { id: SCOUT, handle: 'scout-s', display_name: 'Scout S', is_scout: true, api_key_hash: null },
  ])
  expect(await sql`select id, slug, verified from organizers order by slug`).toEqual([
    { id: ORG, slug: 'org-a', verified: true }, { id: CO, slug: 'org-b', verified: true },
  ])
  expect(await sql`select organizer_id, account_id, role from organizer_members order by organizer_id`)
    .toEqual(expect.arrayContaining([{ organizer_id: ORG, account_id: ORG, role: 'owner' }, { organizer_id: CO, account_id: CO, role: 'owner' }]))
  expect(await sql`select organizer_id, role from event_organizers where event_id = ${EV1} order by role`)
    .toEqual([{ organizer_id: CO, role: 'co_host' }, { organizer_id: ORG, role: 'creator' }])
  expect(await sql`select account_id from sessions`).toEqual([{ account_id: ORG }])
  expect(await sql`select entity_type from edit_history order by entity_type`).toEqual([{ entity_type: 'account' }, { entity_type: 'event' }])
  expect(await sql`select account_id from ingest_sources`).toEqual([{ account_id: SCOUT }])
  expect(await sql`select to_regclass('publishers') as p, to_regclass('invites') as i`).toEqual([{ p: null, i: null }])
})
it('refuses to migrate when a scout owns an event', …) // insert event_owners row for SCOUT at 0021 → migrateTo(url, null) rejects; publishers table still exists
it('refuses to migrate when invites has rows', …)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/db/src/migrations.test.ts`
Expected: FAIL — `relation "accounts" does not exist`.

- [ ] **Step 3: Update `packages/db/src/schema.ts`**

Replace `publishers`, `invites`, `eventOwners` with the tables in the spec 1.1; rename the FK columns listed there (keep each `onDelete` as today: sessions/magic tokens cascade, edit_history/events.created_by/ingest_sources restrict, ingest_items.decided_by set null). Keep the partial unique index on `event_organizers` (`event_organizers_one_creator_per_event`, `role = 'creator'`). Update the doc comments ("unclaimed" = no organizer rows).

- [ ] **Step 4: Write the migration SQL**

Create the empty custom migration: `pnpm --filter ./packages/db exec drizzle-kit generate --custom --name accounts_organizers` (produces `0022_accounts_organizers.sql` and a journal entry). Write the SQL by hand, in the order of spec 1.2, inside the file (drizzle wraps each migration file in a transaction). Guards use `DO $$ BEGIN IF EXISTS (…) THEN RAISE EXCEPTION '…'; END IF; END $$;`. Enum swap for `edit_history_entity_type`: create `edit_history_entity_type_new`, `ALTER COLUMN entity_type TYPE … USING (CASE entity_type::text WHEN 'publisher' THEN 'account' ELSE entity_type::text END)::edit_history_entity_type_new`, drop old, rename new. `event_owner_role` → `ALTER TYPE … RENAME TO event_organizer_role; ALTER TYPE event_organizer_role RENAME VALUE 'co_owner' TO 'co_host'`. Constraint and index names must match what drizzle generates for the new schema (`<table>_<column>_<reftable>_<refcolumn>_fk`, `<table>_pkey`, `<table>_<col>_unique`), so later generated migrations don't try to rename them — copy them from the snapshot produced in Step 5.

- [ ] **Step 5: Produce the 0022 snapshot**

`drizzle-kit generate --custom` copies the 0021 snapshot, which no longer matches `schema.ts`. Generate a correct one without interactive rename prompts: copy `packages/db/drizzle.config.ts` to a temp config with `out` pointing at an empty temp folder, run `drizzle-kit generate --config <temp>`, take its `meta/0000_snapshot.json`, set `"prevId"` to the `"id"` of `0021_snapshot.json` and `"id"` to a new uuid, save as `meta/0022_snapshot.json`.

- [ ] **Step 6: Verify schema and snapshot agree**

Run: `pnpm --filter ./packages/db exec drizzle-kit generate --name should_be_empty`
Expected: `No schema changes, nothing to migrate`. If it generates a file, the SQL's constraint/index names differ from the snapshot — fix the SQL, delete the generated file and its journal entry, repeat.

- [ ] **Step 7: Run the migration test**

Run: `npx vitest run packages/db/src/migrations.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Migrate the local dev DB and commit**

Run `pnpm db:migrate` (the rest of the code won't compile until Task 5; that's expected). Commit schema, migration, snapshot, journal and test: `git commit -m "DB: split publishers into accounts and organizers"`.

---

### Task 2: Shared schemas and permissions

**Files:**
- Create: `packages/shared/src/accounts.ts`, `packages/shared/src/organizers.ts`
- Delete: `packages/shared/src/publishers.ts`
- Modify: `packages/shared/src/events.ts`, `packages/shared/src/permissions.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/permissions.test.ts`

**Interfaces:**
- Produces (`@open-event-db/shared`):
  - `slugSchema` (moved to `organizers.ts`, unchanged), `handleSchema` (same format as `slugSchema`)
  - `organizerPublicSchema` `{ id, name, slug, links, verified, created_at }`, `organizerDetailSchema` (= public + `upcoming_events: EventSlim[]`), `organizerListQuerySchema` (cursor + `q`), `organizerListResponseSchema`, `organizerUpdateSchema` (partial `{ name, slug, links }`), `checkSlugQuerySchema`, `checkSlugResponseSchema`; types `OrganizerPublic`, `OrganizerDetail`, `OrganizerUpdateInput`
  - `accountMembershipSchema` `{ id, name, slug, role: 'owner'|'member', verified }`, `accountMeSchema` `{ id, email, handle, display_name, is_scout, has_api_key, auth_method: 'api_key'|'session', organizers: AccountMembership[] }`, `accountUpdateSchema` (partial `{ handle, display_name }`), `checkHandleQuerySchema` `{ handle }`, `apiKeyResponseSchema` (moved); types `AccountMe`, `AccountMembership`, `AccountUpdateInput`
  - events: `eventOrganizerRoleSchema` = `['creator','co_host']`, `eventOrganizerSchema` `{ id, name, slug, role }`, `eventAddedBySchema` `{ id, handle, display_name, is_scout }`, detail field `organizers` (replaces `owners`), list query `organizer_id` (replaces `publisher_id`), `addOrganizerSchema` `{ organizer_id: uuid }` (replaces `addOwnerSchema`), event create body gets optional `organizer_id: uuid`
  - permissions: `PermissionEvent { organizers: readonly { organizer_id: string; role: EventOrganizerRole }[] }`, `PermissionActor { id: string; is_scout: boolean; organizer_ids: readonly string[] }`, `isClaimed`, `actorRole(event, actor): EventOrganizerRole | null` (creator wins when the actor belongs to several of the event's organizers), `canEdit`, `canCancel`, `canManageOrganizers`

- [ ] **Step 1: Rewrite the permission tests**

Keep the existing cases, translated (publisher → actor with `organizer_ids: [ORG]`), and add:

```ts
it('a member of both creator and co-host organizers counts as creator', () => {
  const actor = { id: 'a', is_scout: false, organizer_ids: [CO, ORG] }
  expect(actorRole(claimed, actor)).toBe('creator')
  expect(canCancel(claimed, actor)).toBe(true)
})
it('an actor without matching organizers cannot edit a claimed event, even as scout', () => {
  expect(canEdit(claimed, { id: 's', is_scout: true, organizer_ids: [] })).toBe(false)
})
it('an actor without organizers or scout flag can do nothing', () => {
  const plain = { id: 'p', is_scout: false, organizer_ids: [] }
  expect(canEdit(unclaimed, plain)).toBe(false)
  expect(canCancel(unclaimed, plain)).toBe(false)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/shared/src/permissions.test.ts` — Expected: FAIL (`actorRole` not exported).

- [ ] **Step 3: Implement the schemas and permissions listed under Interfaces**

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/shared` — Expected: PASS. `pnpm --filter ./packages/shared typecheck` — Expected: no errors.

- [ ] **Step 5: Commit** — `git commit -m "Shared: account and organizer schemas, organizer-based permissions"`

---

### Task 3: API auth, accounts and organizers routes

**Files:**
- Modify: `packages/api/src/auth.ts`, `packages/api/src/history.ts`, `packages/api/src/routes/auth.ts`, `packages/api/src/app.ts`, `packages/api/src/email.ts` (wording only)
- Create: `packages/api/src/routes/accounts.ts`, `packages/api/src/routes/organizers.ts`, `packages/api/src/test/fixtures.ts`
- Delete: `packages/api/src/routes/publishers.ts`
- Test: `packages/api/src/routes/auth.test.ts`, Create: `packages/api/src/routes/organizers.test.ts`

**Interfaces:**
- Consumes: Task 1 tables, Task 2 schemas and `PermissionActor`.
- Produces:
  - `auth.ts`: `type AuthAccount = Account & { organizerIds: string[] }` (ids of **verified** organizers the account belongs to); `req.account: AuthAccount | null`; `currentAccount(req): AuthAccount`; `actorOf(a: AuthAccount): PermissionActor`; `requireAuth` (no longer checks `verified`), `requireSession`, `authenticate`; `writeRateLimit` keyed by `req.account?.id ?? req.ip`.
  - `history.ts`: `EntityType = 'event' | 'venue' | 'account' | 'organizer'`; `logEdit(tx, { entityType, entityId, accountId, action, diff })`.
  - `test/fixtures.ts`: `createAccount(opts?: { scout?: boolean; organizer?: { verified?: boolean } | false; label?: string }): Promise<{ account: Account; key: string; organizer: Organizer | null }>` (creates account with API key, and by default a verified organizer it owns — `organizer: false` for none); `createOrganizer(memberIds: string[], opts?: { verified?: boolean }): Promise<Organizer>`; `cleanup(): Promise<void>` deletes everything the helpers created (history, events created by them, memberships, organizers, accounts) in FK-safe order.
  - Routes exactly as spec 1.4: `GET /auth/me` → `AccountMe`; `GET /accounts/check-handle`; `PUT /accounts/me` (session or key; `handle_taken`); `POST /accounts/me/api-key` (session only); `GET /organizers` (verified only), `GET /organizers/check-slug`, `GET /organizers/:slug` (404 for unverified), `PUT /organizers/:slug` (members only → 403 `not_a_member`; `slug_taken`; logs `organizer/updated`).

- [ ] **Step 1: Write failing tests**

`auth.test.ts`: port existing tests to `createAccount`; add

```ts
it('/auth/me lists verified and unverified memberships', async () => {
  const { account, key } = await createAccount()
  const extra = await createOrganizer([account.id], { verified: false })
  const res = await app.inject({ url: '/api/v1/auth/me', headers: auth(key) })
  expect(res.json().data).toMatchObject({ handle: account.handle, is_scout: false, organizers: expect.arrayContaining([
    expect.objectContaining({ id: extra.id, verified: false, role: 'owner' }) ]) })
})
it('an account without rights may log in and read /auth/me', …) // createAccount({ organizer: false }) → 200
```

`organizers.test.ts`:

```ts
it('lists only verified organizers', …)            // unverified one absent from GET /organizers, 404 on /organizers/:slug
it('members update their organizer, others get 403 not_a_member', …)
it('rejects a taken slug with slug_taken', …)
it('updates own handle, rejects a taken one with handle_taken', …) // PUT /accounts/me
it('logs organizer edits as entity organizer with the account as actor', …)
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/api/src/routes/auth.test.ts packages/api/src/routes/organizers.test.ts` → FAIL.

- [ ] **Step 3: Implement** `auth.ts` (load verified memberships in the same request as the account: one query on `organizer_members` join `organizers` where `verified`), `history.ts`, `fixtures.ts`, the two route files, `/auth/me`; register routes in `app.ts`; `routes/auth.ts` magic-link: send links to **any** existing account (no `verified` check — spec 1.3 "Login").

- [ ] **Step 4: Run tests** — same command → PASS.

- [ ] **Step 5: Commit** — `git commit -m "API: accounts and organizers routes, account-based auth"`

---

### Task 4: API events

**Files:**
- Modify: `packages/api/src/routes/events.ts`, `packages/api/src/queries/events.ts`, `packages/api/src/queries/duplicates.ts`, `packages/api/src/images/events.ts`, `packages/api/src/routes/venues.ts`
- Test: `packages/api/src/routes/writes.test.ts`, `packages/api/src/queries/duplicates.test.ts`, `packages/api/src/routes/images.test.ts`

**Interfaces:**
- Consumes: Task 3 `currentAccount`, `actorOf`, `logEdit({ accountId })`, fixtures; Task 2 permissions.
- Produces: `getOrganizers(eventId): Promise<{ organizer_id: string; role: EventOrganizerRole }[]>` (replaces `getOwners`); `hasOrganizers` SQL fragment used by `provenanceSql` and `claimed`; event detail `organizers` and `added_by` per spec 1.4; `GET /events?organizer_id=`; `POST /events/:id/organizers` `{ organizer_id }` (target must be verified → 400 `Organizer is not verified`; already present → 400); `DELETE /events/:id/organizers/:organizer_id`; `replaceEventImage(…, { accountId, detach })`.

- [ ] **Step 1: Port `writes.test.ts` to fixtures and add creation-rule tests**

```ts
it('a scout who is also a member creates an unclaimed event when no organizer_id is given', async () => {
  const { key } = await createAccount({ scout: true }) // owns a verified organizer too
  const res = await post('/api/v1/events', eventBody, key)
  expect(res.json().data).toMatchObject({ claimed: false, organizers: [] })
})
it('with organizer_id the event belongs to that organizer', …)          // organizers: [{ id, role: 'creator' }], provenance 'organizer'
it('a member of one organizer creates for it without organizer_id', …)
it('a member of two organizers must choose: 400 organizer_required', …)
it('someone else\'s organizer_id → 403 not_a_member', …)
it('a member of an unverified organizer cannot create or edit', …)      // 403 both
it('an account without rights cannot create', …)                        // 403
it('co-host management uses organizer ids', …)                          // POST/DELETE /events/:id/organizers
it('GET /events?organizer_id= lists the organizer\'s events', …)
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/api/src/routes/writes.test.ts` → FAIL.

- [ ] **Step 3: Implement** the creation rules of spec 1.3 in `POST /events`, replace owner logic with organizer logic everywhere in `events.ts` and the query modules, `added_by` join on `accounts`. `venues.ts`: only the history call and `currentAccount` change; who may edit venues stays as today (any logged-in account — restricting it is step 2 of the spec).

- [ ] **Step 4: Run tests** — `npx vitest run packages/api/src/routes/writes.test.ts packages/api/src/queries packages/api/src/routes/images.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "API: events belong to organizers"`

---

### Task 5: API ingest, extract and remaining modules

**Files:**
- Modify: `packages/api/src/routes/ingest.ts`, `packages/api/src/ingest/run.ts`, `packages/api/src/ingest/image.ts`, `packages/api/src/lineup/backfill.ts`, `packages/api/src/routes/extract.ts`
- Test: `packages/api/src/routes/ingest.test.ts`, `packages/api/src/ingest/run.test.ts`, `packages/api/src/ingest/detach.test.ts`, `packages/api/src/ingest/schema.test.ts`, `packages/api/src/ingest/fit/score.test.ts`, `packages/api/src/lineup/backfill.test.ts`, `packages/api/src/routes/extract.test.ts`, `packages/api/src/email.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces: nothing new; source attribution reads `ingestSources.accountId`; "claimed" checks use organizers; merge permission uses `canEdit(…, actorOf(me))`.

- [ ] **Step 1: Port the listed tests to the fixtures** (scouts: `createAccount({ scout: true, organizer: false })`), and add one test to `ingest.test.ts` that pins existing behavior:

```ts
it('accepting a feed item always creates an unclaimed event, even when the scout is an organizer member', async () => {
  const { key } = await createAccount({ scout: true }) // also owns a verified organizer
  // accept a pending item of a test source with this key
  expect(acceptedEvent).toMatchObject({ claimed: false, organizers: [] })
})
```

The accept endpoint takes no `organizer_id`; an accepted event can be claimed for an organizer afterwards (`claim-event` until step 4 of the spec).
- [ ] **Step 2: Implement the renames** in the listed source files.
- [ ] **Step 3: Full API verification**

Run: `npx vitest run packages/api` → all PASS. `pnpm --filter ./packages/api typecheck` → no errors. `grep -rniE "publisher" packages/api/src --include='*.ts' | grep -v fixtures/` → no output (HTML fixtures of venue sites may contain the word).
- [ ] **Step 4: Commit** — `git commit -m "API: ingest, extract and lineup on accounts"`

---

### Task 6: CLI and seed

**Files:**
- Modify: `packages/db/src/cli.ts`, `packages/db/src/seed.ts`, `scripts/prod-db.sh` (usage comment)

**Interfaces:**
- Produces: the CLI commands of spec 1.6 with these exact usages:
  `create-account <handle> <email> [--name <display name>] [--scout]`,
  `create-organizer <name> <slug> <member_handle>` (verified, member role owner),
  `add-member <organizer_slug> <handle>`, `remove-member <organizer_slug> <handle>`,
  `set-scout <handle> on|off`, `set-email <handle> <email>`, `api-key <handle>`,
  `claim-event <event_id> <organizer_slug>`, `delete-account <handle> [--yes]`,
  `ingest-add-source <slug> <name> <url> <scout_handle> …` (rest unchanged).
- `delete-account`: removes sessions, magic link tokens, memberships, api key, email (replaced with `deleted-<id>@invalid`), handle (`deleted-<id>`), display name ("Deleted account"), scout flag; events and history stay. If the account was the **last member** of an organizer, print a warning naming the organizer (it stays, public, without members).
- Seed: organizers `letzte-welle` and `nachtagentur` each with one owner account, one scout account; events owned via `event_organizers`.

- [ ] **Step 1: Implement** commands and seed.
- [ ] **Step 2: Verify against a fresh local DB**

Run: `pnpm db:down && pnpm db:up && pnpm db:migrate && pnpm db:seed`, then
`pnpm db:cli create-account testi testi@example.org --scout`, `pnpm db:cli create-organizer "Test Org" test-org testi`, `pnpm db:cli add-member nachtagentur testi`, `pnpm db:cli remove-member nachtagentur testi`, `pnpm db:cli delete-account testi --yes`
Expected: each prints a success line; the last one warns that `test-org` has no members left.
- [ ] **Step 3: Commit** — `git commit -m "CLI and seed: accounts and organizers"`

---

### Task 7: Web app

**Files:**
- Modify: `packages/web/src/lib/api.ts`, `packages/web/src/lib/session.ts`, `packages/web/next.config.mjs`, `packages/web/src/app/dashboard/page.tsx`, `packages/web/src/app/profile/page.tsx`, `packages/web/src/app/events/[id]/page.tsx`, `packages/web/src/app/events/[id]/edit/page.tsx`, `packages/web/src/app/events/new/page.tsx`, `packages/web/src/app/ingest/page.tsx`, `packages/web/src/app/ingest/[id]/page.tsx`, `packages/web/src/app/login/page.tsx`, `packages/web/src/app/venues/**`, `packages/web/src/components/{EventForm,NewEventForm,Header,UserMenu,ApiKeySection}.tsx`
- Move: `packages/web/src/app/publishers/[slug]/page.tsx` → `packages/web/src/app/organizers/[slug]/page.tsx`
- Replace: `components/ProfileForm.tsx` → `components/AccountForm.tsx` + `components/OrganizerForm.tsx`; `components/CoOwnersEditor.tsx` → `components/CoHostsEditor.tsx`

**Interfaces:**
- Consumes: Task 2 types, Task 3–4 endpoints.
- Produces: `getCurrentAccount(): Promise<AccountMe | null>` (replaces `getCurrentPublisher`); `getOrganizer(slug)`, `getMe(cookie): Promise<AccountMe | null>`; redirect `{ source: '/publishers/:slug', destination: '/organizers/:slug', permanent: true }` in `next.config.mjs`.
- UI rules (spec 1.5): profile = account section + one `OrganizerForm` per membership; dashboard = "Your organizers' events" section for members and "Events you added" for scouts (both if both); `EventForm` "Publish as" select when options > 1, scouts default to "As scout, without organizer", value sent as `organizer_id` (omitted for the scout option); event page "Added by" shows `display_name`, organizers link to `/organizers/<slug>`. Copy: "publisher" → "organizer" in every user-visible string.

- [ ] **Step 1: Implement** the changes.
- [ ] **Step 2: Typecheck and tests** — `pnpm --filter ./packages/web typecheck` and `npx vitest run packages/web` → PASS.
- [ ] **Step 3: Verify in the browser** (preview configs `api` and `web`, seeded DB; log in by inserting a `magic_link_tokens` row and opening `/api/v1/auth/verify?token=` — see memory). Check, logged in as a scout who owns an organizer:
  - feed and an event page render; organizer link goes to `/organizers/<slug>`
  - `/publishers/letzte-welle` answers 308 and lands on `/organizers/letzte-welle`
  - `/profile` shows account and organizer sections; saving each works
  - `/events/new` shows "Publish as" defaulting to the scout option; creating with each option gives an unclaimed / owned event
  - dashboard shows both sections; co-host editor adds and removes an organizer
  - `/ingest` inbox loads
- [ ] **Step 4: Commit** — `git commit -m "Web: accounts and organizers"`

---

### Task 8: Legal copy, docs and the final sweep

**Files:**
- Modify: `packages/web/src/content/legal/{datenschutz,impressum,lizenz,nutzungsbedingungen}.ts`, `DEPLOY.md`

- [ ] **Step 1: Replace "Publisher" in the legal texts** with "Veranstalter:innen" (Organizer) wording without changing any legal substance; the account section of the Datenschutz text now says accounts are for people and organizer profiles are public. **Show the diff of these four files to the project owner for approval before committing** — they are legal texts.
- [ ] **Step 2: `DEPLOY.md`**: add the pre-deploy snapshot step, the API-key check and the post-deploy account merge (spec 1.2, 1.8).
- [ ] **Step 2b: Uberblick (old)**: read, then update the Developer Reference pages Data Model `01a131fd-7673-7122-b488-ea2bcdf8804e`, REST API `01a13200-4109-7e4a-821b-f76e45bd56de`, Authentication & Email `01a131ff-232e-7806-bc03-2414c8f17b84`, Web App & Design System `01a13201-c3dd-7c61-8af9-77e086d137bb` to describe the code as it now is; tick them in the Page Impact of PRD `01a1cbf3-1ce7-7661-b207-b61862eadeb3`. Other sessions edit these pages too — read each right before updating it.
- [ ] **Step 3: Sweep**

Run: `grep -rniE "publisher" packages/*/src scripts DEPLOY.md --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.md' --include='*.sh' | grep -v "ingest/fixtures/"`
Expected: only the redirect line in `next.config.mjs` and migration SQL references.
Run: `pnpm typecheck && npx vitest run` → all PASS.
- [ ] **Step 4: Commit** — `git commit -m "Copy and docs: organizers instead of publishers"`

---

### Task 9: Production dry run (with the project owner)

No code. Needs the production DB password, so the project owner runs the commands that ask for it.

- [ ] **Step 1: API key check** — project owner runs `scripts/prod-db.sh sh -c 'psql "$DATABASE_URL" -c "select slug, api_key_hash is not null as has_key from publishers"'` (single quotes: `prod-db.sh` sets `DATABASE_URL` only inside its own process). Expected: no key outside the owner's own accounts. If there is one, stop and decide with the owner.
- [ ] **Step 2: Dump and restore** — owner runs `scripts/prod-db.sh sh -c 'pg_dump --no-owner --no-acl "$DATABASE_URL"' > <scratchpad>/prod.sql`; restore into a fresh local database `oedb_prod_copy`.
- [ ] **Step 3: Migrate the copy** — `DATABASE_URL=postgres://oedb:oedb@localhost:5432/oedb_prod_copy pnpm db:migrate` → succeeds; row counts of `accounts` = old `publishers`, `event_organizers` = old `event_owners`.
- [ ] **Step 4: Click through** — start API and web against the copy and repeat the browser checks of Task 7 Step 3 with real data (feed, an event with organizers, an unclaimed event, venue page, inbox).
- [ ] **Step 5: Hand over** — report results; deploy (manual DB snapshot, fast-forward into `main`, push) and the account merge happen only on the owner's go.
