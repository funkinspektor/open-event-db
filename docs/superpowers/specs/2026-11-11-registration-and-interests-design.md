# Open Registration and Interests — Design

Status: drafted on 2026-11-11 from decisions taken in conversation; awaiting the project owner's review. Steps 2 and 5 of `2026-11-11-accounts-and-organizers-design.md`, shipped together in one release.

## Why

Step 1 split publishers into accounts and organizers; accounts are still created only by the admin CLI. This release lets anyone create an account and gives that account a reason to exist: mark events as "interested", see them as a filtered feed and get them in their own calendar. Kellerkompass stays fully usable without an account.

Success: a visitor goes from "Interested" on an event to a marked event in their calendar app in under two minutes; nobody can find out through the login form whether an address is registered; an account can delete itself and change its email without the CLI; the privacy policy describes all of this before registration opens.

## Decisions taken in the conversation

1. **Registration ships together with interests** (steps 2 + 5). Suggestions (step 3) and organizer requests/claims (step 4) come later.
2. **Handle:** pre-filled from the display name, chosen by the person at first login; they can overwrite it.
3. **Consent:** a checkbox at first login, together with display name and handle; the time of consent is stored.
4. **Self-deletion:** immediate, after a confirmation that asks to type the handle.
5. From the earlier brainstorm (unchanged): login doubles as sign-up via Magic Link; the account is created on the first click of the link, not when the email is entered; "Interested" only, no "going"; interest counts are stored but shown nowhere, not even in the public API; the personal feed is an "Only mine" toggle in the public feed's filter area; a private iCal link per account, regenerable.

## Scope

In scope: sign-up through the login form, first-login onboarding (display name, handle, consent), self-service email change and account deletion, return-to after login, interests (mark, unmark, "Only mine" filter, marker in the feed, past marked events collapsed), iCal subscription, a CLI command to read interest counts, privacy policy and terms updates.

Out of scope: suggestions, organizer requests, claims, venue operators (steps 3–4), public interest counts, "going", follows, public person profiles, notifications, reporting/blocking, social login, passwords.

Already done in step 1 and not repeated: venue editing and event creation are limited to scouts and members of verified organizers (`requireRights`); `/events/new` and the dashboard already show a fitting notice to accounts without those rights.

---

## Part A — Registration and account basics

### A.1 Sign-up through the login form

`POST /api/v1/auth/magic-link` keeps its request and response exactly as today (same message whether or not the address exists; sending happens in the background so timing reveals nothing; rate limit 3/h per email plus the per-IP limit).

- Known address → login link as today.
- Unknown address → a **sign-up link** to that address. Nothing is created yet except the token.

`magic_link_tokens` changes: `account_id` becomes nullable and a new `email text not null` column holds the address the link was sent to (backfilled from the account for existing rows). A token with `account_id = null` is a sign-up token.

`GET /api/v1/auth/verify`:
- Login token → session as today.
- Sign-up token → inside the same transaction that claims the token: if an account with that email exists by now (a second sign-up link was clicked first), log into it; otherwise create the account with a provisional handle (`new-<8 random chars>`), display name `''`, `onboarded_at = null`. Then the session.
- Redirect: `return_to` (see A.3) when given, else `/dashboard`; the web app sends accounts with `onboarded_at = null` to `/welcome` first (A.2).

The emails differ only in wording (the recipient owns the mailbox, so this reveals nothing to anyone else): "Your Kellerkompass login link" vs. "Confirm your email to join Kellerkompass", in the same language as today's mail.

Abuse: an account only exists after someone clicked a link in that mailbox. The existing rate limits stay; a daily cap of sign-up mails per IP (default 10) is added to the magic-link route for unknown addresses only.

### A.2 First login: `/welcome`

Shown once, until completed: while `onboarded_at` is null, every page except `/welcome`, logout and the legal pages redirects to `/welcome?return_to=<the requested path>`, so the person still lands where they wanted afterwards.

Fields:
- **Display name** (required, 1–60 chars, trimmed). Shown as "Added by" on events the account adds later and in the header.
- **Handle** (required, slug format, unique, live availability check via `GET /accounts/check-handle`). Pre-filled from the display name (lowercase, umlauts transliterated, non-alphanumerics → `-`, trimmed, max 40); as long as the person hasn't touched the field it follows the name; once edited it stays as typed.
- **Checkbox (required):** "I accept the Terms of Use and have read the Privacy Policy." with both linked.

`POST /api/v1/accounts/me/onboarding { display_name, handle, accept_terms: true }` (session only) sets the fields, `terms_accepted_at = now()`, `onboarded_at = now()`. 400 `handle_taken`, 400 `terms_required`. Afterwards redirect to `return_to` or `/`.

Existing accounts (migrated from publishers) are set to `onboarded_at = now()` by the migration, `terms_accepted_at` stays null — they are the owner's own accounts. The magic-link CLI accounts (`create-account`) are created onboarded.

### A.3 Return-to after login

Login and "Interested" while logged out must land the person back where they were. The login form and the inline login (B.2) send `return_to` with the magic-link request; it is stored on the token (`magic_link_tokens.return_to text null`) and used by `/auth/verify`. Only a same-site path is accepted (must start with `/`, not `//`, max 500 chars) — anything else is dropped, so the link can't become an open redirect.

### A.4 Settings: email change and account deletion

On `/profile` (account section):

- **Change email:** field + "Send confirmation". `POST /api/v1/accounts/me/email { email }` (session only) sends a link to the **new** address (token kind `email_change`, stores the new address; 24 h validity); the response doesn't reveal whether the new address is taken. Clicking the link sets the email if it is still free (else shows "This address is already in use") and sends a short notice to the **old** address ("Your Kellerkompass email was changed to …; if this wasn't you, reply to this mail"). The account's sessions stay valid.
- **Delete account:** a danger-zone section. The dialog explains what happens (personal data gone; events you added stay as "Added by Deleted account"; interests and calendar link gone) and lists organizers that would be left without members. The person types their handle to enable the button. `DELETE /api/v1/accounts/me` (session only, body `{ confirm_handle }`) runs the same deletion as the CLI's `delete-account`, then clears the cookie; the web shows a goodbye page.

The deletion logic moves from `packages/db/src/cli.ts` into one function in `packages/db` (`deleteAccount(db, accountId)` returning the orphaned organizers), used by both the CLI and the API, so the two can't drift. It additionally removes the account's interests and calendar token (B.1, B.4).

### A.5 Header and login page

- Logged out, the header link reads **"Log in"** and the page `/login` says "Log in or sign up — we'll email you a link." (no separate sign-up page).
- The user menu gets **"My events"** (→ `/?mine=1`) for every logged-in account; "Create event" stays limited as in step 1.

### A.6 Legal texts (owner review required before release)

- **Datenschutz:** section 4 gets public accounts (email, display name, handle, time of consent, sessions); a new section "Gemerkte Events und Kalender-Link" (what is stored, that counts are not published, that the iCal link is secret and can be regenerated, deletion with the account); retention (until deletion; deleted accounts keep an anonymous placeholder for events they added); legal basis Art. 6 Abs. 1 lit. b DSGVO (providing the account features).
- **Nutzungsbedingungen:** accounts are open to everyone 18+; one person per account; the checkbox is the acceptance.
- The drafts are written in the implementation and shown to the owner before the release commit, as in step 1.

---

## Part B — Interests and the personal feed

### B.1 Data

`event_interests (account_id → accounts on delete cascade, event_id → events on delete cascade, created_at, primary key (account_id, event_id))`, index on `event_id` for counting. No status column now; "going" would add one later with default `interested`.

### B.2 Marking

- `PUT /api/v1/events/:id/interest` and `DELETE /api/v1/events/:id/interest` — any logged-in account (session or API key), idempotent, `writeRateLimit`. 404 for unknown events. Cancelled and past events can be marked and unmarked too.
- Web: an **"Interested"** toggle (star-like marker, filled when marked) on event cards in lists and on the event page. Optimistic update, reverted with a toast on error.
- Logged out: the toggle opens an inline login sheet (email field, same `POST /auth/magic-link` with `return_to=/events/<id>?interest=1`). After login (and `/welcome` for new accounts) the event page sees `interest=1`, marks the event, removes the parameter from the URL and shows "Saved to My events".

### B.3 Reading

- `GET /api/v1/accounts/me/interests?from=&to=` → `{ data: { event_ids: string[] } }`, for the feed to fill in markers (one call per page render, not per card).
- `GET /api/v1/events?mine=true` (auth required, else 401) filters the normal list to the account's interests; every other filter, the search and the cursor keep working.
- Event detail gets `interested: boolean` only when the request is authenticated; it is absent for anonymous requests, so public responses stay identical and cacheable.
- **Counts are not exposed anywhere.** CLI: `pnpm db:cli interest-stats [--upcoming] [--limit N]` prints events with their number of interested accounts.

### B.4 Feed: "Only mine"

- In the feed toolbar's filter area, visible only when logged in, a prominent **"Only mine"** toggle (`/?mine=1`), combinable with search, date range and categories, kept by `filtersToHref`.
- With the toggle on: the upcoming marked events as usual, then a collapsed **"Past"** section with marked events of the last 90 days (newest first), expandable.
- Empty state with the toggle on: "Nothing saved yet. Tap ☆ on an event to keep it here and in your calendar."
- Next to the toggle (when on): **"Add to calendar"** opens a small panel with the iCal link (copy button, "Open in Apple Calendar" via `webcal://`, a Google Calendar hint) and **"New link"**, which invalidates the old one after a confirmation.

### B.5 iCal subscription

- `accounts.calendar_token text unique null`: a random 32-byte base64url token, created on first use of "Add to calendar", replaced by "New link". Stored in plain text on purpose: the link must be shown again later, and it only grants read access to the account's own marked events. `POST /api/v1/accounts/me/calendar-token` (session only) creates or rotates it and returns the URL.
- `GET https://api.kellerkompass.de/cal/<token>.ics` (no auth besides the token; unknown token → 404; own rate limit 60/h per token). Returns `text/calendar` with one `VEVENT` per marked event from 90 days back onward:
  - `UID:<event id>@kellerkompass.de`, `DTSTAMP`, `LAST-MODIFIED` from `updated_at`, `SEQUENCE` = seconds of `updated_at` since creation (monotonic, so calendar apps take changes).
  - Start/end in UTC; no known start time → all-day `DTSTART;VALUE=DATE`; no end → 4 hours after start for timed events.
  - `SUMMARY` = title, `LOCATION` = venue name + address (or location text), `URL` = event page, `DESCRIPTION` = first 500 chars of the plain-text description + the URL.
  - `STATUS:CANCELLED` for cancelled events, title prefixed "Postponed:" for postponed ones.
  - Calendar name `X-WR-CALNAME:Kellerkompass – My events`, `REFRESH-INTERVAL;VALUE=DURATION:PT1H`.
  - Line folding at 75 octets and escaping per RFC 5545, in a small tested serializer (no new dependency).

---

## Data changes (one migration)

- `accounts`: `onboarded_at timestamptz null`, `terms_accepted_at timestamptz null`, `calendar_token text unique null`; backfill `onboarded_at = created_at` for existing rows.
- `magic_link_tokens`: `account_id` nullable, new `email text not null` (backfill from accounts), `kind` enum `login | signup | email_change` (backfill `login`), `return_to text null`, `new_email text null` (for `email_change`).
- New `event_interests` (B.1).

## Testing

- API: sign-up token creates exactly one account even when two sign-up links are clicked; magic-link response and timing identical for known/unknown; `return_to` rejects `//evil.example` and `https://…`; onboarding errors; email change (taken address, notice to old address); self-delete removes interests and calendar token and matches the CLI result; interest PUT/DELETE idempotent; `mine=true` 401 without auth and combined with filters; detail `interested` only when authenticated; no count anywhere in public responses; iCal: unknown token 404, rotated token 404, all-day/timed/cancelled/postponed events, folding and escaping.
- Web: handle pre-fill function (umlauts, punctuation, length), `return_to` handling, browser check of the full path "Interested while logged out → email → link → /welcome → back on the event, marked → Only mine → calendar link".

## Release

One deploy. Before it: the owner approves the legal texts. The migration only adds columns and a table (no destructive step), so no snapshot ceremony beyond the usual. After it: sign up once with a fresh address on production and run the full path above.

## Open points for the owner

1. The sign-up mail cap per IP (default 10/day) and the iCal rate limit (60/h per token) — fine as defaults?
2. Past marked events shown for 90 days in "Only mine" and in the calendar — fine?
3. Email change keeps existing sessions alive (simpler); alternative: log out all other sessions. Default: keep.
