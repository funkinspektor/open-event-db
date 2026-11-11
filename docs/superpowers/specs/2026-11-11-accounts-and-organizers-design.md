# Accounts, Organizers and Open Registration — Design

Status: approved in conversation on 2026-11-11, awaiting spec review.

## Why

Kellerkompass is opening up. Until now every account was created by hand with the admin CLI, and every account was a "publisher": one row that is at the same time a login (an email address) and a public profile (a collective with a slug and links). That worked while only trusted people had accounts. It breaks with what comes next:

- **Anyone can register**, to mark events as interesting, get a personal feed and calendar, and suggest events.
- **Anyone can suggest events.** Suggestions from accounts nobody vouched for go through the review inbox; scouts' events stay live right away.
- **Organizers are verified people acting for a group**, and they can take over events that scouts added.
- Later: **follow** organizers, venues and people, and **public profiles** for everyone.

A collective has several people, a person can be in several collectives, followers follow the group and not whoever holds the login, and events must stay with the collective when a member leaves. So this design splits the publisher into two things — the person who logs in and the group that acts in public — and renames everything accordingly, in the database, the code, the CLI and the public API.

Success: one person has one account no matter how many roles they have; every event belongs to organizers, not to logins; the public API and URLs use the new names; open registration, suggestions, claims and interests are built on top without further restructuring.

## Decisions taken in the conversation

1. **One account type for everyone.** Rights are flags and memberships on top of a plain account, never a separate login.
2. **Open registration via Magic Link.** Kellerkompass stays fully usable without an account.
3. **Every account may suggest events.** Suggestions from plain accounts land in the existing review inbox; **all scouts** review them. Nothing is public before acceptance (pre-moderation, not post-moderation).
4. **Scouts are made by hand.** Their events go live right away, as today. Trust comes from having suggested good events.
5. **Organizers are verified only by the project owner**, by email and CLI. No admin role, no admin UI.
6. **No scope on organizer verification.** A verified organizer may create any event. Taking over an existing event is a **claim request** in the inbox, which a scout accepts or declines. Exception: an organizer's member may claim an event they suggested themselves without review.
7. **Claims get their own inbox tab** with a count, and claim cards look visibly different from feed items. Suggestions stay in "New" with a clear "Suggested by …" label and a "Suggestions" entry in the source filter.
8. **Rejected suggestions:** the scout may give a short optional reason; the submitter sees status and reason under their own suggestions. No rejection email. Accepted (or merged into an existing event) → a short "your event is live" email.
9. **"Interested" only**, no "going" for now. Counts are stored from day one but **shown nowhere** — not on the site and not in the public API — until the project owner switches them on.
10. **Personal feed = a filter on the public feed** ("Only mine", a prominent toggle in the filter area for logged-in accounts), plus a **private iCal subscription link** per account. Past marked events show collapsed at the end of the filtered feed.
11. **Accounts and organizers are separate entities** (this spec, section 1). Venues stay places; an organizer can be linked to venues as their operator.
12. **The rename reaches the public API** (`/organizers`, `/accounts`), in place in v1: there are no external consumers yet.

## The target model

| Entity | What it is | Examples |
|---|---|---|
| **Account** | A person with a login (Magic Link), a handle and a display name. May be a scout. | the project owner, every visitor |
| **Organizer** | A public profile of whoever makes events: a collective, a solo DJ, the team running a venue. Has members (accounts), is verified. | Letzte Welle, Nachtagentur |
| **Venue** | A place, edited wiki-style. Optionally operated by one organizer. | Berghain, ACUD |

Rules:

- **Rights come from exactly two sources:** the account's `is_scout` flag, and membership in a verified organizer. A person never owns an event or operates a venue directly; someone who runs a bar alone has an organizer with one member.
- **Events belong to organizers.** Today's event owners (creator, co-owner) become the event's organizers (creator, co-host). An event without organizers is unclaimed, as today, and editable by scouts.
- **"Added by" stays an account** (immutable provenance, as today). Edit history records the account, so it shows *who* in a collective changed something.
- **A venue has at most one operator; an organizer can operate several venues.** The operator link is what later lets claims for one's own venue skip review (the "scope" idea, deferred).
- **Provenance is unchanged:** `organizer` (has organizers) > `venue_site` > `scout`.
- Account handles and organizer slugs are **separate namespaces** (`/organizers/<slug>`, later `/people/<handle>`).

What the model must carry later without restructuring (not built now): follows (account → organizer / venue / account), public person profiles (private by default, opt-in), "going" as a second status next to "interested", several members per organizer and invites into an organizer (this is where the old invite idea lands), notifications with email preferences, profile images, reporting and blocking, personal MCP tools.

## Delivery in five steps

Each step is its own branch, tested, fast-forwarded into `main` and deployed before the next starts. Step 1 is specified in detail here; steps 2–5 are outlined with their decisions and get their own spec when they start.

1. **Identity restructure** — accounts, organizers, memberships, rename everywhere incl. the public API. No new behavior.
2. **Open registration and account basics** — sign-up, self-service deletion and email change, venue editing restricted, privacy policy update.
3. **Suggestions** — every account may submit events; review in the inbox.
4. **Organizer requests and claims** — request an organizer profile, verification by CLI, claim requests in their own inbox tab, venue operators.
5. **Interests and personal feed** — mark as interested, "Only mine" filter, iCal subscription.

---

## Step 1: Identity restructure

Goal: the data model, code, CLI, API and URLs speak of accounts and organizers. Everything a user can do today still works the same way; nobody can do anything new.

### 1.1 Schema

New and renamed tables (Drizzle names in parentheses):

**`accounts`** (`accounts`) — replaces `publishers` as the login entity.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | **same id as the old publisher row** |
| `email` | text unique not null | login |
| `handle` | text unique not null | from the old slug; slug format |
| `display_name` | text not null | from the old name |
| `is_scout` | boolean not null default false | |
| `api_key_hash` | text | API keys stay per account and act with the account's rights |
| `created_at`, `updated_at` | timestamptz | |

**`organizers`** (`organizers`) — the public profile of a group.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | for migrated publishers: **same id as the old publisher row** |
| `name` | text not null | |
| `slug` | text unique not null | |
| `links` | jsonb not null default `{}` | |
| `verified` | boolean not null default false | migrated rows keep their `verified` value; step 4 creates unverified ones |
| `created_at`, `updated_at` | timestamptz | |

**`organizer_members`** — `organizer_id` → organizers (cascade), `account_id` → accounts (cascade), `role` enum `organizer_member_role` = `owner | member`, pk (organizer_id, account_id). Step 1 only ever writes `owner`; `member` exists for step-6 invites so the enum need not change then.

**`event_organizers`** — renamed from `event_owners`: `event_id`, `organizer_id` (was `publisher_id`) → organizers (cascade), `role` enum renamed `event_owner_role` → `event_organizer_role` with values `creator | co_host` (was `co_owner`). The "at most one creator" partial unique index stays.

Repointed foreign keys (column renamed `publisher_id` → `account_id` unless noted, target `accounts`, same `onDelete` as today):

- `events.created_by` (name unchanged)
- `sessions.account_id`, `magic_link_tokens.account_id`
- `edit_history.account_id`
- `ingest_sources.account_id` (the scout sync edits are attributed to)
- `ingest_items.decided_by` (name unchanged)

Dropped:

- `publishers` (after the copy).
- `invites` and `publishers.invited_by`: no endpoint ever used them. Invites come back in step 6 as invites into an organizer, with their own table. The migration asserts the table is empty before dropping it.
- `publishers.is_publisher`: replaced by organizer membership.

Enum `edit_history_entity_type`: `publisher` → `account` (rename value), add `organizer`, remove `invite` once `invites` is gone (Postgres can't drop enum values, so the migration recreates the type).

### 1.2 Migration

Hand-written SQL migration (`drizzle-kit generate --custom`), because drizzle-kit turns renames into drop-and-create, which would destroy production data. Everything in one transaction:

1. Create `accounts`, copy every publisher (`id, email, slug → handle, name → display_name, is_scout AND verified → is_scout, api_key_hash, created_at, updated_at`). Accounts have no `verified` flag: trust lives in `is_scout` and in the organizer's `verified`. Today an unverified publisher can neither log in nor write, so an unverified scout must not become a scout.
2. Create `organizers`, copy every publisher with `is_publisher = true` (`id, name, slug, links, verified, created_at, updated_at`).
3. Create `organizer_members`, insert `(id, id, 'owner')` for each of those.
4. Guard: fail if any `event_owners` row points at a publisher with `is_publisher = false`, or if `invites` has rows.
5. Rename `event_owners` → `event_organizers`, its column and enum; repoint its FK to `organizers`.
6. Rename the `publisher_id` columns and swap every FK listed above to `accounts`. Because ids were kept, no row values change.
7. Recreate `edit_history_entity_type` with the new values, mapping `publisher` → `account`.
8. Drop `invites`, then `publishers`.

Because ids are kept, every existing reference (event owners, sessions, history, ingest) stays valid without row updates, and active sessions survive the deploy: nobody is logged out.

**Verification before production:**
- A migration test: migrate a scratch database to the previous migration, insert publishers (organizer, scout), events with owners, sessions, history and ingest rows, apply the new migration, assert row counts, ids and FKs.
- A dry run on a restored copy of the production database (`scripts/prod-db.sh` dump → local restore → migrate → start API and web → click through feed, event page, login, dashboard, edit, inbox).
- Check that no production account other than ours has an API key (`api_key_hash is not null`), since the API changes shape.

**After the deploy (manual, project owner):** the owner's two accounts (`letzte-welle` login and scout `sebastian`) become one person: add `sebastian` as owner of organizer `letzte-welle` (`add-member`), then delete the account `letzte-welle` (`delete-account`; its history entries then read "Deleted account", as with any deleted account). No merge command is built for this one-off.

### 1.3 Permissions (`packages/shared/src/permissions.ts`)

Same rules, new subject. The actor becomes `{ id, is_scout, organizer_ids }` (ids of verified organizers the account belongs to). The event carries `organizers: { organizer_id, role }[]`.

- Unclaimed (no organizers): scouts edit and cancel — unchanged.
- `canEdit`: the actor is a member of any of the event's organizers.
- `canCancel`, `canManageOrganizers`: the actor is a member of the event's **creator** organizer.

Creating an event: an account that belongs to a verified organizer creates it **for that organizer** (creator). The request takes an optional `organizer_id`; it is required when the account belongs to more than one organizer and must be one of them. An account without an organizer creates unclaimed events if it is a scout, and is refused otherwise (until step 3). This is today's behavior expressed in the new model.

Login: today only verified publishers get a Magic Link, and `requireAuth` refuses writes from unverified ones. After step 1 every existing account may log in (accounts are still only created by the CLI, so this opens nothing), and write rights come only from `is_scout` and membership in a verified organizer. An account without either can log in and change its own settings, nothing else.

### 1.4 Public API (in place, v1)

| Today | After step 1 |
|---|---|
| `GET /publishers`, `GET /publishers/:slug`, `GET /publishers/check-slug` | `GET /organizers`, `GET /organizers/:slug`, `GET /organizers/check-slug` |
| `PUT /publishers/me` (name, slug, links) | `PUT /organizers/:slug` (members only) for name, slug, links; `PUT /accounts/me` for handle and display name |
| `POST /publishers/me/api-key` | `POST /accounts/me/api-key` |
| `GET /auth/me` → publisher | `GET /auth/me` → account `{ id, email, handle, display_name, is_scout, has_api_key, auth_method, organizers: [{ id, name, slug, role }] }` |
| — | `GET /accounts/check-handle` |
| event `owners: [{ publisher_id, name, slug, role }]` | event `organizers: [{ id, name, slug, role }]`, role `creator \| co_host` |
| event `added_by: { id, slug, name, is_scout }` | event `added_by: { id, handle, display_name, is_scout }` |
| `GET /events?publisher_id=` | `GET /events?organizer_id=` (`added_by=` unchanged, an account id) |
| `POST /events/:id/owners` `{ publisher_id }` | `POST /events/:id/organizers` `{ organizer_id }` |
| `POST /events` | optional `organizer_id` (see 1.3) |

The public organizer object drops `is_publisher`/`is_scout` (those were account properties): `{ id, name, slug, links, verified, created_at }`. Accounts have no public endpoint in step 1; `added_by` is the only place an account appears publicly, as today.

Zod schemas move accordingly: `packages/shared/src/publishers.ts` splits into `accounts.ts` and `organizers.ts`.

### 1.5 Web app

- `/publishers/[slug]` → `/organizers/[slug]`; the old path answers with a permanent redirect so shared links keep working.
- `/profile` becomes **account settings** (display name, handle, email read-only, API key) with one section per organizer the account belongs to (name, slug, links) — editing goes to `PUT /organizers/:slug`.
- Dashboard: members see the events of their organizers; scouts see the events they added (as today). An account that is both sees both, in two sections.
- Event form: if the account belongs to more than one organizer, a "Publish as" select; otherwise nothing new.
- Co-host editor: picks organizers instead of publishers; label stays "Co-hosts".
- `lib/session.ts`, header user menu, badges and copy: "publisher" → "organizer" wording where it is user-visible.

### 1.6 CLI (`pnpm db:cli`)

| Today | After step 1 |
|---|---|
| `create-publisher <name> <slug> <email> [--scout]` | `create-account <handle> <email> [--name <display name>] [--scout]` and `create-organizer <name> <slug> <member_handle>` |
| — | `add-member <organizer_slug> <handle>`, `remove-member <organizer_slug> <handle>` |
| — | `set-scout <handle> on\|off` |
| `set-email <slug> <email>` | `set-email <handle> <email>` |
| `api-key <slug>` | `api-key <handle>` |
| `claim-event <event_id> <publisher_slug>` | `claim-event <event_id> <organizer_slug>` |
| `delete-publisher <slug>` | `delete-account <handle>` (personal data goes, row stays as "Deleted account", memberships removed) |
| `ingest-add-source … <scout_slug>` | `ingest-add-source … <scout_handle>` |

### 1.7 Everything else touched

- Seed: two organizers with one owner account each, one scout account.
- Ingest: source attribution and `decided_by` use accounts; claim detection ("has organizers") replaces "has owners".
- Rate limits and the extract quota are keyed by account id (same values as today).
- Tests: all existing Vitest suites pass after renaming; new tests for the migration (1.2), the permission matrix with multi-organizer membership, and `organizer_id` on event creation.
- Docs: `DEPLOY.md` (nothing env-related changes; mention the one-off account merge), Uberblick developer reference pages (Data Model, REST API, Auth, Web App) and the affected PRDs.

### 1.8 Deploy

API and web change together (the web app calls the renamed endpoints), so step 1 ships as one push to `main` that deploys both. The API container runs the migration on start. Rollback = restore the pre-deploy database snapshot and redeploy the previous images; take a manual snapshot of `kellerkompass-db` right before the push.

---

## Step 2: Open registration and account basics (outline)

- `/login` doubles as sign-up: entering an unknown email creates a plain account on the first Magic Link click (not when the email is entered, so typos don't create accounts). `magic_link_tokens` therefore carries the email and a nullable `account_id`. Handle generated from the email's local part, editable in settings; display name asked once after the first login.
- The magic-link endpoint stays enumeration-safe and rate-limited as today.
- **Self-service account deletion** in settings (same effect as `delete-account`), **self-service email change** (confirm via Magic Link to the new address).
- **Venue editing restricted** to scouts and members of verified organizers (today: any logged-in account).
- `/events/new` for a plain account explains what happens next instead of the form (until step 3 lands, or step 3 ships together with step 2).
- **Privacy policy and terms updated** for the new data: accounts of the public, interests, suggestions, calendar token. Must be live before registration opens.

## Step 3: Suggestions (outline)

- Plain accounts get the full event form incl. flyer import; submitting creates a **suggestion**, not an event. Suggestions are stored as inbox items from a built-in "Suggestions" source (`kind = 'suggestion'`), so the inbox's accept / reject / merge-with-duplicate flow, duplicate hints and fit scoring work unchanged. The item records the submitting account.
- Accepting creates the event unclaimed with `created_by` = the submitting account (provenance stays `scout`-level until claimed). The event page's "Added by" therefore shows the submitter's display name publicly; the submit form says so, and the privacy policy (step 2) covers it.
- Daily limit for suggestions from plain accounts (default 5, configurable).
- "My suggestions" (in settings or the dashboard): pending → "In review", accepted/merged → link to the event, rejected → "Not accepted" plus the scout's optional reason. Pending suggestions can be withdrawn, not edited.
- Email on accept or merge: "Your event is live". No email on rejection.
- Scouts' events keep going live directly.

## Step 4: Organizer requests and claims (outline)

- A button in account settings: "I organize events". A form for name, links and free text creates an **unverified organizer** with the account as owner and emails the project owner (address from an env var). Verification is the CLI: `verify-organizer <slug>`. Unverified organizers are not public and grant no rights.
- Verified organizer members see **"This is our event"** on unclaimed events. It creates a **claim request** shown in the inbox tab **"Claims"** (count on the tab; card shows the requesting organizer — name, links, members, verified since — next to the event incl. "Added by" and feed origin). Accept = the organizer becomes the event's creator (as `claim-event` does today, incl. stopping feed sync); decline with an optional reason.
- Claims of events the claiming account itself added (`created_by`) are accepted immediately.
- Events that already have organizers show no claim button; the co-host route via the creator organizer remains.
- **Venue operators:** `venues.operated_by` → organizers (nullable, set by CLI `set-operator <venue_id> <organizer_slug|none>`). Venue page shows "Operated by …", organizer page lists operated venues. Auto-accepting the operator's claims for its venues is deferred (open gap: with many scouts, reviewers can't know who really organizes an event).

## Step 5: Interests and personal feed (outline)

- `event_interests (account_id, event_id, created_at)`, pk on both, with room for a later `status` (`interested | going`).
- "Interested" toggle on event cards and the event page. Logged out → the Magic Link sign-in opens inline; after login the event is marked.
- Counts are stored but **not exposed**: no count on the site, none in the public API. A config switch turns them on later; the project owner reads them via CLI/SQL until then.
- Feed toolbar: prominent **"Only mine"** toggle for logged-in accounts (`/?mine=1`), works together with search, date range and categories; marked events show a filled marker in the normal feed; with the filter on, past marked events show collapsed at the end. "My events" in the user menu links to the filtered feed.
- **iCal subscription:** a per-account secret token, `GET /cal/<token>.ics` lists the marked events (cancellations and time changes flow through). The link is shown next to the filter and can be regenerated, which invalidates the old one.

## Out of scope for all five steps

Follows, public person profiles, organizer member invites and multi-member management UI, "going", notifications beyond the transactional mails above, an admin role or admin UI, reporting and blocking, auto-accepting claims by venue scope.
