# Event Images and Inbox Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Events get an image, stored in our own bucket and shown on the event page, in share previews and in list rows; it can be replaced or removed in the edit form. Feed items bring their image along on accept and sync. Scouts also get a full event-page preview of each inbox item, with the same accept, reject, link and gone actions as the inbox list.

**Architecture:** An `ImageStore` in the API (Scaleway Object Storage through `aws4fetch` in production, a local folder in development, memory in tests) holds the image objects under `events/<event id>/<uuid>.<ext>`. Only the key is stored in `events.image_key`, and responses turn it into `image_url`. The browser uploads a prepared JPEG to `PUT /events/:id/image`. Accept and sync fetch the feed image on the server. The event page body becomes a component that `/events/[id]` and the new `/ingest/[id]` both render.

**Tech Stack:** Fastify 5, Drizzle 0.36 + drizzle-kit, Zod, Vitest 2 against the local docker Postgres, Next.js 15, `aws4fetch@^1.0.20` (new API dependency).

**Spec:** No separate spec. The decisions in the chat on 2026-10-28 are recorded under "Decisions" below.

## Decisions

- Images live in our own storage, not hotlinked: on the public site, visitors never load images from third-party hosts.
- The image shows on the event page, as `og:image`, as a thumbnail in event list rows, and in the edit form, where owners and scouts can replace or remove it.
- The inbox preview at `/ingest/[id]` looks like the event page and has the decision flow: accept, reject, link to a duplicate (with the duplicate warning), and keep or cancel for gone items.
- In the inbox (cards and preview) the draft image is still the feed's URL. Only scouts see it, and it shows exactly what accept would copy.

## Global Constraints

- Accepted image types: `EXTRACT_IMAGE_TYPES` (`image/png`, `image/jpeg`, `image/webp`), checked by file signature, never by the `Content-Type` header.
- `EVENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024` (new, in `packages/shared/src/events.ts`), for uploads and for remote fetches.
- Object keys: `events/<event id>/<randomUUID()>.<jpg|png|webp>`. Objects are written with `cache-control: public, max-age=31536000, immutable` and `x-amz-acl: public-read`.
- Image failures never fail an accept, a sync run or an event save: the event goes on without the new image, and the failure is logged.
- An image change made by a person counts as an edit: it logs edit history and detaches the feed item (`detachIngest`), like `PUT /events/:id`.
- The API bundle stays native-free (esbuild bundles everything into `dist/`), so no `sharp` on the server. The browser's `prepareImage` (`packages/web/src/lib/image.ts`) re-encodes uploads, which also drops EXIF data.
- Env: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (🔒), `IMAGE_BASE_URL`. Without `S3_BUCKET`, development uses `IMAGE_DIR` (default `<repo>/.data/images`, gitignored), served by the API at `GET /images/*` with base `http://localhost:3001/images`. In production without a bucket the store is off: uploads answer 503 `images_unavailable`, and accept/sync skip images.

## Review Focus

- **Feed image fails to load at accept** (404, timeout, HTML error page, 20 MB poster): the event is created without an image, and the next run retries. Pin it in Task 4 with `accepts without an image when the feed image cannot be fetched` and `retries the image on the next run`.
- **Image changes or disappears in the feed after accept:** the event follows it while it is synced, but never after a person changed the image (detached). Pin it in Task 4 with `replaces the image when the feed image changes`, `removes it when the feed drops it` and `leaves a detached event's image alone`.
- **Replacing an image twice quickly, or deleting the event's image:** the old object is deleted only after the database points at the new one, so no event ever points at a missing object. Pin it in Task 3 with `deletes the previous object after replacing`.
- **Store off in production (no bucket configured):** accept still works, and events with a stored key show no broken image (`image_url: null`). Pin it in Task 2 with `serializes image_url as null when no store is configured`.
- **A scout opens `/ingest/<id>` for an item that is already decided, over or unknown:** the page shows its state with no action buttons, or 404; it never offers a decision the API would refuse. Pin it in Task 7 with `reports the state of decided and over items` and the 404 case.

---

### Task 1: Image store, sniffing and remote fetch

**Files:**
- Create: `packages/api/src/images/store.ts`, `packages/api/src/images/sniff.ts`, `packages/api/src/images/fetch.ts`, `packages/api/src/images/images.test.ts`
- Modify: `packages/api/src/routes/extract.ts` (import `sniffImageType` from `../images/sniff.js`, no behaviour change), `packages/api/src/app.ts` (register `GET /images/*` when the store is local), `packages/api/package.json` (`aws4fetch`), `.env.example`, `.gitignore` (`.data/`), `DEPLOY.md` (bucket section: create a public-read bucket in `fr-par`, an API key with Object Storage write access, the env table rows above)

**Interfaces:**
- Produces:
  - `type ImageType = ExtractImageType`
  - `sniffImageType(data: Buffer): ImageType | null` (moved as is)
  - `interface ImageStore { put(key: string, data: Buffer, type: ImageType): Promise<void>; delete(key: string): Promise<void>; url(key: string): string }`
  - `imageStore: { get store(): ImageStore | null; setStore(s: ImageStore | null): void; reset(): void }`: the holder pattern of `textExtraction`; the default comes from env as described in Global Constraints.
  - `memoryImageStore(base = 'https://images.test'): ImageStore & { objects: Map<string, { data: Buffer; type: ImageType }> }`, for tests.
  - `s3ImageStore(cfg: { endpoint; region; bucket; accessKeyId; secretAccessKey; baseUrl }, fetchImpl = fetch): ImageStore`: path-style `${endpoint}/${bucket}/${key}` through `AwsClient` from `aws4fetch` (`service: 's3'`).
  - `localImageStore(dir: string, baseUrl: string): ImageStore`
  - `imageKey(eventId: string, type: ImageType): string`
  - `fetchRemoteImage(url: string, fetchImpl = fetch): Promise<{ data: Buffer; type: ImageType } | null>`: http(s) only, 15 s timeout, reads at most `EVENT_IMAGE_MAX_BYTES + 1` bytes and returns null above the limit, sniffs the type, returns null on any failure.

- [ ] **Step 1: Write the failing tests** in `images.test.ts`:
  - `sniffImageType` recognises PNG/JPEG/WEBP headers and returns null for `<html>`.
  - `imageKey('e1', 'image/jpeg')` matches `/^events\/e1\/[0-9a-f-]{36}\.jpg$/`.
  - `s3ImageStore.put` sends `PUT https://s3.test/bucket/events/x.jpg` with `content-type: image/jpeg`, `x-amz-acl: public-read`, the cache-control above and an `authorization` header starting `AWS4-HMAC-SHA256`; `delete` sends `DELETE` to the same URL; `url('events/x.jpg')` is `https://cdn.test/events/x.jpg`; a non-2xx answer makes `put` reject.
  - `localImageStore` writes the file and `GET /images/events/x.jpg` on `buildApp` (with that store installed) answers 200 with the type, while `/images/../secret` answers 404.
  - `fetchRemoteImage`: returns the PNG for a stub answering a PNG; returns null for 404, for an HTML body, for `ftp:` URLs and for a body of `EVENT_IMAGE_MAX_BYTES + 1` bytes.
- [ ] **Step 2: Run** `pnpm --filter @open-event-db/api exec vitest run src/images` → FAIL (modules missing).
- [ ] **Step 3: Implement** the three modules and the dev route. Path traversal: resolve the key under `dir` and refuse anything outside it.
- [ ] **Step 4: Run** the same command and `src/routes/extract.test.ts` → PASS.
- [ ] **Step 5: Commit**: `"Event images: object store, signature sniffing and remote fetch"`

### Task 2: Image columns and `image_url` in event responses

**Files:**
- Modify: `packages/db/src/schema.ts` (`events.imageKey: text('image_key')`, `ingestItems.imageSourceUrl: text('image_source_url')`), new migration via `pnpm --filter @open-event-db/db generate`, `packages/shared/src/events.ts` (`image_url: z.string().url().nullable()` on `eventSlimSchema`, inherited by detail; `EVENT_IMAGE_MAX_BYTES`), `packages/api/src/queries/events.ts` (`slimEventColumns` gains `imageKey`; `serializeSlimEvent` and `getEventDetail` set `image_url`; `eventSnapshot` includes `image_key`)
- Test: `packages/api/src/routes/writes.test.ts` (or the events read tests next to it)

**Interfaces:**
- Consumes: `imageStore` (Task 1)
- Produces: `imageUrlOf(key: string | null): string | null` in `queries/events.ts`, null when the key or the store is missing.

- [ ] **Step 1: Write the failing tests**: an event row with `imageKey: 'events/a/b.jpg'` comes back from `GET /api/v1/events/:id` and from the list with `image_url: 'https://images.test/events/a/b.jpg'` (memory store installed), and without a key as `image_url: null`. `serializes image_url as null when no store is configured`: `imageStore.setStore(null)`, same row → `null`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**, then `pnpm --filter @open-event-db/db generate && pnpm --filter @open-event-db/db migrate`.
- [ ] **Step 4: Run** `pnpm test` → PASS (shared/web snapshots that list event fields get `image_url`).
- [ ] **Step 5: Commit**: `"Event images: image_key column and image_url in event responses"`

### Task 3: Upload and remove an event's image

**Files:**
- Create: `packages/api/src/images/events.ts`
- Modify: `packages/api/src/routes/events.ts` (two routes; a buffer content-type parser for the three image types, scoped to the route plugin like `extract.ts`)
- Test: `packages/api/src/routes/images.test.ts`

**Interfaces:**
- Consumes: `imageStore`, `imageKey`, `sniffImageType` (Task 1); `detachIngest`, `logEdit`, `diff`, `eventSnapshot`, `canEdit`
- Produces:
  - `replaceEventImage(eventId: string, image: { data: Buffer; type: ImageType } | null, opts: { publisherId: string; via?: 'ingest'; detach: boolean }): Promise<string | null>`: uploads the new object first, then in one transaction locks the event, sets `image_key`, logs the edit (`diff` of `image_key`, plus `via` when given) and detaches when `detach`. After commit it deletes the previous object; on a failed transaction it deletes the new one. Returns the new key. Both deletes are best effort and logged.
  - `PUT /api/v1/events/:id/image`: raw image body, `bodyLimit: EVENT_IMAGE_MAX_BYTES`, 415 `unsupported_media_type` for anything else, 403 without edit rights, 404 for an unknown event, 503 `images_unavailable` without a store. Answers `{ data: EventDetail }`.
  - `DELETE /api/v1/events/:id/image`: same rules, sets the key to null, answers `{ data: EventDetail }`.

- [ ] **Step 1: Write the failing tests**: the owner uploads a PNG → 200, `image_url` set, the object is in the memory store, edit history has `image_key`; `deletes the previous object after replacing` (the second upload leaves exactly one object); DELETE → `image_url: null`, no objects left; a stranger → 403; HTML body with `content-type: image/png` → 415; 5 MB + 1 byte → 413; no store → 503; uploading to an event synced from a feed item sets the item's `detachedAt`.
- [ ] **Step 2: Run** `pnpm --filter @open-event-db/api exec vitest run src/routes/images.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**: `"Event images: upload and remove an event's image"`

### Task 4: Feed images on accept and sync

**Files:**
- Modify: `packages/api/src/routes/ingest.ts` (accept), `packages/api/src/ingest/run.ts`
- Create: `packages/api/src/ingest/image.ts`
- Test: `packages/api/src/routes/ingest.test.ts`, `packages/api/src/ingest/run.test.ts`

**Interfaces:**
- Consumes: `replaceEventImage`, `fetchRemoteImage` (Tasks 1 and 3)
- Produces: `syncItemImage(item: IngestItem, draft: IngestDraft, publisherId: string, fetchImpl?: typeof fetch): Promise<void>`. It acts only when `item.eventId` is set, the item is not detached, a store exists and `draft.image_url !== item.imageSourceUrl`. A null draft image removes the event image. A fetched image replaces it (`via: 'ingest'`, `detach: false`) and then sets `imageSourceUrl = draft.image_url`. A failed fetch leaves both unchanged, so the next run retries. A test hook `ingestImages.setFetch(fn)` / `reset()` (holder pattern) lets tests stub the network.

- [ ] **Step 1: Write the failing tests**:
  - Accept with a stubbed PNG → the event has `image_url`, and the item has `image_source_url` = the draft URL.
  - `accepts without an image when the feed image cannot be fetched` (stub answers 404) → 200, `image_url: null`.
  - Run tests: `replaces the image when the feed image changes` (accepted item, second run with another `ATTACH` URL → new object, old one deleted); `removes it when the feed drops it`; `retries the image on the next run` (first fetch fails, unchanged feed on the second run fetches again and sets it); `leaves a detached event's image alone`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**: accept calls `syncItemImage` after its transaction commits. `ingestEvent` calls it after the update transaction and also on the unchanged-hash path for accepted, attached items, so a failed fetch is retried without a feed change.
- [ ] **Step 4: Run** `pnpm --filter @open-event-db/api exec vitest run src/routes/ingest.test.ts src/ingest` → PASS.
- [ ] **Step 5: Commit**: `"Event images: copy feed images on accept and keep them in sync"`

### Task 5: Show the image on the event page, in share previews and in list rows

**Files:**
- Modify: `packages/web/src/lib/site.ts` (`shareMetadata(path, title, description, image?: string | null)`: adds `openGraph.images: [image]` and `twitter.card: 'summary_large_image'` when given), `packages/web/src/app/events/[id]/page.tsx` (pass `e.image_url`; render it at the top of the aside, full aside width, natural aspect ratio, `alt=""`, linking to the full image), `packages/web/src/components/EventRow.tsx` (`kk-thumb` before the aside when `event.image_url`, `loading="lazy"`), the global stylesheet only if `kk-thumb` needs a list-row variant
- Test: `packages/web/src/lib/site.test.ts` (new): `shareMetadata` with an image sets both fields; without one sets neither.

- [ ] **Step 1: Write the failing test** and run `pnpm --filter @open-event-db/web exec vitest run src/lib/site.test.ts` → FAIL.
- [ ] **Step 2: Implement** the three changes.
- [ ] **Step 3: Run** the test → PASS. Then check visually with the preview (`preview_start` web + api): one event with an image on `/`, `/events/<id>` and a phone-width viewport; the page source has `og:image`.
- [ ] **Step 4: Commit**: `"Event images: event page, share preview and list thumbnail"`

### Task 6: Replace or remove the image in the event form

**Files:**
- Create: `packages/web/src/components/EventImageInput.tsx`
- Modify: `packages/web/src/components/EventForm.tsx`, `packages/web/src/app/events/[id]/page.tsx` (`SAVED_MESSAGES`)

**Interfaces:**
- Produces: `EventImageInput({ current: string | null; value: ImageChange; onChange(v: ImageChange) })` with `type ImageChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'replace'; blob: Blob; preview: string }`. It shows the current or new image with "Replace image" (file picker, `prepareImage`, `ImageError` message inline) and "Remove image". On create it starts empty with "Add image".

- [ ] **Step 1: Implement**: `EventForm` keeps an `ImageChange`. After a successful `POST`/`PUT` of the event it sends `PUT …/image` (blob, `content-type: image/jpeg`) or `DELETE …/image`, then navigates as today. If only the image request fails, it navigates with `saved=created_image_failed` / `updated_image_failed`; the new messages read "Event created, but the image couldn’t be saved. Edit the event to try again." and "Changes saved, but the image couldn’t be saved. Try again."
- [ ] **Step 2: Verify in the preview**: add, replace and remove an image on a local event; the event page and the list follow each change; a 30 MB photo is downscaled before upload (network panel: request below `EVENT_IMAGE_MAX_BYTES`).
- [ ] **Step 3: Run** `pnpm -r typecheck` → clean.
- [ ] **Step 4: Commit**: `"Event images: add, replace or remove the image in the event form"`

### Task 7: `GET /ingest/items/:id`

**Files:**
- Modify: `packages/shared/src/ingest.ts`, `packages/api/src/routes/ingest.ts`
- Test: `packages/api/src/routes/ingest.test.ts`

**Interfaces:**
- Produces:
  - `ingestItemStateSchema = z.enum(['new', 'gone', 'accepted', 'rejected', 'over'])`
  - `ingestItemDetailSchema = ingestItemViewSchema.extend({ state: ingestItemStateSchema, venue: venueDetailEmbedSchema.nullable() })` and type `IngestItemDetail`.
  - `GET /api/v1/ingest/items/:id` (scouts only, same 401/403 as the list) → `{ data: IngestItemDetail }`; 404 for an unknown or non-uuid id or a broken draft. `state` uses the list's own conditions: `new` = `isNew()`, `gone` = `isGone`, otherwise `accepted`/`rejected` by status, and a pending item that is over is `over`. Duplicates are filled for `new` only, as in the list.

- [ ] **Step 1: Write the failing tests**: a pending item → `state: 'new'`, duplicates and the venue with address and coordinates; `reports the state of decided and over items` (accepted → `accepted` with `event_id`, rejected → `rejected`, ended yesterday → `over`, gone → `gone`); unknown id → 404; non-scout → 403.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, sharing the row-to-view mapping with `listItems`. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**: `"Inbox: single item endpoint with its state"`

### Task 8: Inbox preview page

**Files:**
- Create: `packages/web/src/components/EventDetailBody.tsx`, `packages/web/src/app/ingest/[id]/page.tsx`, `packages/web/src/components/IngestDecisionBar.tsx`, `packages/web/src/lib/ingest-actions.ts`
- Modify: `packages/web/src/app/events/[id]/page.tsx` (renders `EventDetailBody`), `packages/web/src/components/IngestInbox.tsx` (uses `ingest-actions`), `packages/web/src/components/IngestItemCard.tsx` (title links to `/ingest/{id}`), `packages/web/src/lib/api.ts` (`getIngestItem(id, cookie): Promise<IngestItemDetail | null>`)

**Interfaces:**
- Consumes: `IngestItemDetail` (Task 7), `image_url` (Task 5)
- Produces:
  - `EventDetailBody(props: { title; startsAt; endsAt; status; recurrence; tags; description; links; venue: z.infer<typeof venueDetailEmbedSchema> | null; locationText; city; imageUrl; headerAction?: ReactNode; children?: ReactNode })`: everything the event page shows today from the status banner to the location aside, with `children` in place of the "Organised by"/"Added by" section and the report link, which stay in the event page.
  - `ingestAction<T>(path: string, body: unknown): Promise<{ data: T } | { error: string; status: number }>`: the fetch half of `IngestInbox.call`.
  - `IngestDecisionBar({ item: IngestItemDetail })` (client): source badge, "Times unverified", "Original" link, the "Possible duplicate" box with "Link to this event", and the buttons for the item's `state`. For `new`: Reject and Accept. For `gone`: Keep and Cancel event. For `accepted`: "Accepted", with "Open event" when `event_id` is set. For `rejected`/`over`: a line saying so. After Accept it goes to `/events/{event_id}?saved=accepted` (new message "Accepted — it’s live now."); after Reject, Link, Keep or Cancel it goes back to `/ingest` (or `/ingest?view=gone`). A 409 shows the error and refreshes.
- Page: server component, `notFound()` for non-scouts and unknown items, `robots: { index: false }`, an "← Inbox" back link, `IngestDecisionBar` above `EventDetailBody` fed from `item.draft` (+ `item.venue`, `status: 'scheduled'`, no tags or recurrence).

- [ ] **Step 1: Implement** the extraction first and check that `/events/<id>` renders as before (preview screenshot before/after at desktop and phone width).
- [ ] **Step 2: Implement** the page, the bar and the shared action helper.
- [ ] **Step 3: Verify in the preview** with the local `test-duncker` and `test-acud` items: the card title opens the preview; Accept lands on the event page with the image and the toast; Reject returns to the inbox without the item; an item with a duplicate shows the box and Link works; a gone item offers Keep and Cancel; `/ingest/<accepted id>` shows "Accepted" without buttons; a non-scout gets 404.
- [ ] **Step 4: Run** `pnpm -r typecheck && pnpm test` → clean and PASS.
- [ ] **Step 5: Commit**: `"Inbox: full event preview per item with the decision flow"`

### Task 9: Rollout

- [ ] **Step 1: Ask the user** to create the bucket and the API key in Scaleway (or to approve doing it with `scw`, if it is set up) and to set the env vars on the API container.
- [ ] **Step 2:** Push `main` (deploys and migrates). Then accept one Dunckerclub item in production and check that `image_url` points into the bucket and that the page and the share preview show it.
