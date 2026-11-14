# Suggestions (step 3) — design

Status: approved in conversation on 2026-11-14, written for owner review.
Program: `docs/superpowers/specs/2026-11-11-accounts-and-organizers-design.md` (step 3 outline). Product view: Uberblick PRD
"Onboarding: Offene Registrierung, Vorschläge & Organizer-Freischaltung" (`01a1257e-ddb0-7de2-a70b-025cf11c8a43`), section "Schritt 3".

## Why

Since 2026-11-12 anyone can open an account, but only scouts and members of verified organizers can add events.
Everyone else should be able to **suggest** an event. Nothing goes public before someone from Kellerkompass has
checked it, because what goes live lands on the website, in the API and in search engines and cannot be reliably
taken back. People who suggest good events regularly become scout candidates; the owner still promotes them by CLI.

## Decisions

1. **Suggestions are inbox items** of one built-in source "Suggestions". Accept, reject, merge with a duplicate,
   duplicate hints, fit scoring, the inbox counter and the source filter work as they do for feed items. Rejected
   alternatives: a separate `suggestions` table with its own tab (duplicates the whole review flow), pending events
   hidden from the public (every public query would have to filter them; one miss publishes an unchecked suggestion).
2. **Edit & accept.** Scouts can open any inbox item (suggestion or feed) in the normal event form, correct it, pick or
   create a venue, change the image, and publish. Plain "Accept" stays.
3. **Optional image** on a suggestion, through the same image field as the scout form. Using the scanned flyer itself
   as the event image (with cropping) is a separate, later topic for scouts and suggestions alike; until then the
   import image is still never stored.
4. **No notification** to scouts beyond the existing inbox counter.
5. **The inbox card names the person and their record**: "Suggested by Maria (@maria) · 4 of 5 accepted", or
   "first suggestion". This is how the owner spots scout candidates.
6. **Copy rule:** nothing a suggesting person sees says "scout". Use "someone from Kellerkompass".
7. Unchanged from the program: daily limit 5 (configurable), "My suggestions" with status and optional reason,
   withdraw while pending (no editing), mail only on accept or merge, scouts and organizer members keep publishing
   directly.

## Data (migration 0024)

- `ingest_source_kind` gains `suggestion`. The migration inserts exactly one source: slug `suggestions`, name
  `Suggestions`, kind `suggestion`, url `https://kellerkompass.de/` (column is NOT NULL; never fetched),
  `official = false`, `enabled = true`, `venue_id = null`.
- `ingest_sources.account_id` becomes nullable, with a check: `kind = 'suggestion' OR account_id IS NOT NULL`. Feed
  sources keep their import account (creator of accepted feed events, author of sync edits); the suggestion source
  needs neither.
- `ingest_item_status` gains `withdrawn`. Withdrawn items keep their row (so the daily limit cannot be bypassed by
  withdraw-and-resend) but are excluded from every inbox view, count and the submitter's record.
- `ingest_items.submitted_by uuid` → `accounts.id` (`on delete cascade`; accounts are anonymised, not deleted, so this
  only matters for the 7-day cleanup of non-onboarded accounts, which can never have suggestions). Index
  `(submitted_by, first_seen_at)` for the daily limit and "My suggestions".
- `ingest_items.reject_reason text` (null for feed items and reasonless rejects; max 500 chars).
- Suggestion items: `external_id` = the item's own id (set on insert), `raw` = the submitted JSON, `content_hash` =
  null-safe hash of the draft (fit scoring re-scores on change; suggestions don't change), `draft` = an
  `IngestDraft` built from the submitted fields (`source_url` = the first link if any, `times_unverified = false`).
- The feed runner and the "gone" logic skip sources of kind `suggestion` (they are never fetched, so never gone).

## API

All new user routes require an onboarded session or API key (`requireOnboarded`).

### For people who suggest

| Route | Behaviour |
| --- | --- |
| `POST /suggestions` | Body: the `POST /events` create schema (title, description, lineup, starts_at, ends_at, venue_id **or** location_text + city, categories, links). No `organizer_id`. Creates a pending item in the suggestions source. 201 `{ data: MySuggestion }`. Limit: `SUGGESTIONS_PER_DAY` (default 5) items with `submitted_by = me` and `first_seen_at` in the last 24 h, withdrawn included → 429 `suggestion_limit` "You've sent 5 suggestions today. Try again tomorrow." |
| `PUT /suggestions/:id/image` | Same body, size and type rules as `PUT /events/:id/image`. Own pending items only (else 404). Stored in the image store under `suggestions/<id>`; the draft's `image_url` points at it. |
| `DELETE /suggestions/:id/image` | Removes it. Own pending only. |
| `DELETE /suggestions/:id` | Withdraw: own pending only (decided → 409). Status `withdrawn`, image deleted. |
| `GET /accounts/me/suggestions` | Own suggestions, newest first, withdrawn excluded: `{ id, title, starts_at, status: 'in_review' \| 'live' \| 'not_accepted', event_id, reason, image_url, created_at }`. `live` covers accept and merge; `event_id` is the event that is live. `Cache-Control: private, no-store`. |

`POST /events/extract` and `POST /events/extract-lineup` move from `requireRights` to `requireOnboarded`, keeping the
per-account daily limit (`EXTRACT_DAILY_LIMIT`). Plain accounts thereby get the flyer import.

`POST /events` keeps `requireRights`: plain accounts get 403 there and use `/suggestions`.

### For scouts (inbox)

- `GET /ingest/items` and `/ingest/items/:id`: items of the suggestions source carry
  `submitter: { display_name, handle, accepted, decided } | null` (`accepted` counts accepted plus merged suggestions,
  `decided` counts accepted, merged and rejected; pending and withdrawn are not counted). `source.kind` is exposed so
  the web app can tell suggestions apart.
- `POST /ingest/items/:id/accept` takes an optional body `{ event: <POST /events create schema> }`. Without it the
  stored draft is published as today; with it the given fields are published instead (venue must exist; the scout
  creates a missing venue in the form first). Works for every source. For suggestions `created_by` is
  `submitted_by`; for feeds it stays the source account. Edit history: the scout, `via: 'suggestion'` or `'ingest'`.
  The stored suggestion image is copied to the event like a feed image, unless the scout changed the image (the web
  app then uploads it to the new event as on the create page). A decided item → 409 as today.
- `POST /ingest/items/reject` takes an optional `reason` (≤ 500 chars), stored on every item of the call. The web app
  only offers it for a single suggestion.
- `POST /ingest/items/:id/link` (merge with an existing event) works for suggestions unchanged.
- After a committed accept or link of a suggestion, the API sends the mail "Your event is live on Kellerkompass"
  (title, date, link to the live event) to the submitter, in the background; a failure is logged, not surfaced.

### Rights and visibility

- Suggestion items are only visible to scouts (inbox) and to their submitter (`/accounts/me/suggestions`). Nothing
  about suggestions is public; no route exposes another person's suggestions or counts.
- An event created from a suggestion is unclaimed (no organizer rows), provenance as for scout-added events, editable
  only by scouts (existing `canEdit`). The event page shows "Added by <display name>" without "· Scout" (the submitter
  is not a scout).

## Web

### Inbox (scouts)

- Suggestion cards show "Suggested by <name> (@handle) · <accepted> of <decided> accepted" (or "first suggestion")
  where feed cards show the source name, plus the uploaded image if any. Source filter entry "Suggestions".
- New action on every card: **Edit & accept** → `/ingest/items/:id/edit`, the normal `EventForm` pre-filled from the
  draft (and image), with VenuePicker incl. creating a venue. "Publish" calls accept with the edited event and then
  the image change; "Cancel" returns to the inbox unchanged. A 409 shows "Someone else decided this item meanwhile."
- Reject on a single suggestion opens an optional field "Reason (shown to the person)". Bulk reject has no reason.

### People who suggest

- Plain accounts (onboarded, not scout, no verified organizer) see **Suggest event** where rights holders see
  "Create event" (user menu and list toolbar). Logged out, the toolbar shows "Suggest event", leading to login with
  `return_to=/events/new`.
- `/events/new` in suggestion mode: same form incl. flyer import and image field; venue is "pick an existing venue or
  type the place" (no venue creation). Above the button: "Someone from Kellerkompass reviews your suggestion before it
  goes live. If it's accepted, your display name is shown as ‘Added by’." Button: **Send suggestion**. After sending:
  "Thanks! Someone from Kellerkompass will review it. We'll email you when it's live." with a link to My suggestions.
  At the limit the form keeps its content and shows the 429 message.
- `/dashboard` gets **My suggestions**: title, date, status — "In review" (with **Withdraw**, after a confirm),
  "Live" (link to the event), "Not accepted" (plus the reason if given). Empty state with a "Suggest event" link.

### Legal texts

Privacy policy and terms get a paragraph on suggestions: what is stored (content, image, who suggested, rejection
reason) and for how long; that the display name is shown publicly as "Added by" when accepted; that uploaded images
must not infringe third-party rights. The owner approves the texts before release.

## Retention and cleanup

- Pending suggestions stay until decided or withdrawn.
- The cleanup job deletes suggestion images of rejected and withdrawn items after 30 days (rows stay for the record,
  duplicate detection and the daily limit). Accepted items' images are copied to the event at accept; the suggestion
  copy is deleted then.
- Account self-delete (`deleteAccount`): pending suggestions of the account become `withdrawn` and their images are
  deleted; decided rows keep pointing at the anonymised account.

## Edge cases

- Two scouts decide the same item: the existing status guard → 409 for the second, also from the edit page.
- A suggestion's venue is deleted before accept: as for feeds, the event falls back to the draft's place text.
- The submitter deletes their account between submit and accept: the item is already withdrawn, so it is gone from
  the inbox.
- A suggestion duplicates an existing event: duplicate hints show it; merge sends the "live" mail with that event.
- The same person suggests the same event twice: both show up; the duplicate hint between pending items is out of
  scope (scouts reject the second).
- Image upload fails after the suggestion was created: the suggestion exists without image; the form says so (as on
  the event create page).

## Testing

API integration tests for: limit (5 → 429, withdrawn still counted), withdraw (own pending only, 404/409 otherwise),
image upload rules, `/accounts/me/suggestions` statuses incl. merge, extract open to plain onboarded accounts and
still closed to non-onboarded ones, accept with and without an edited event (creator = submitter, history `via`),
reject with reason, submitter record counts, inbox excludes withdrawn, `POST /events` still 403 for plain accounts,
deleteAccount withdraws pending suggestions, cleanup deletes old images, the live mail (sent on accept and link, not on
reject). Web: suggestion-mode visibility rules (`canCreateEvents` vs plain), copy without "scout". Browser check of
the whole flow before release.

## Out of scope

Flyer image as event image with cropping; scout notifications; editing pending suggestions; mails on rejection; a
CLI `suggestion-stats`; duplicate hints between pending suggestions; organizer requests and claims (step 4).

## Open points (owner)

1. `SUGGESTIONS_PER_DAY = 5` and 30-day image retention for rejected suggestions — defaults, adjustable by env.
2. Opening the flyer import to every onboarded account costs LLM calls per account (`EXTRACT_DAILY_LIMIT` each); the
   sign-up backstop bounds the number of new accounts per day.
