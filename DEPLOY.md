# Deploying to Scaleway

Two containers, a database and the event images bucket, all in Amsterdam (`nl-ams`). Transactional
Email and the Generative APIs stay in `fr-par` (`SCALEWAY_REGION=fr-par`) — the API reaches both over
HTTPS, so the region split doesn't matter. (Managed PostgreSQL creation in `fr-par` was disabled on 2026-10-14.)

| Piece | Scaleway product | Public URL |
|---|---|---|
| Web (Next.js) | Serverless Container, port 3000 | `https://kellerkompass.de` |
| API (Fastify) | Serverless Container, port 3001 | `https://api.kellerkompass.de` |
| Postgres 16 | Managed Database for PostgreSQL | — |

Web and API run on sibling subdomains so the session cookie can be shared via `COOKIE_DOMAIN`.

## Automatic deploys

`.github/workflows/deploy.yml` builds and rolls out on every push to `main`. It rebuilds only the image whose
sources changed (API first, because it runs the migrations), tags it `:latest` and with the commit SHA, points
the container at the SHA tag and waits until the container is ready again. "Run workflow" in the Actions tab
rebuilds both. To roll back, point the container at an earlier SHA tag in the Scaleway console.

It needs three repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `SCW_SECRET_KEY` | secret key of the IAM application `kellerkompass-deploy`; its policy needs `ContainerRegistryFullAccess` and `ContainersFullAccess` in the project |
| `SCW_WEB_CONTAINER_ID` | ID of the web container (Scaleway console → Serverless Containers → container → Settings) |
| `SCW_API_CONTAINER_ID` | ID of the API container |

The manual steps below still work, for example from a laptop when Actions is down.

## 1. Build and push the images

Serverless Containers run `linux/amd64`, so build for that platform on Apple Silicon.
`NEXT_PUBLIC_API_URL` and `WEB_URL` are compiled into the web image.

```bash
REGISTRY=rg.nl-ams.scw.cloud/kellerkompass
docker login rg.nl-ams.scw.cloud -u nologin   # password: secret key of the IAM application kellerkompass-deploy

docker build --platform linux/amd64 -f Dockerfile.api -t $REGISTRY/api:latest .
docker build --platform linux/amd64 -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_API_URL=https://api.kellerkompass.de \
  --build-arg WEB_URL=https://kellerkompass.de \
  -t $REGISTRY/web:latest .

docker push $REGISTRY/api:latest
docker push $REGISTRY/web:latest
```

## 2. Environment

Put secrets (marked 🔒) into the container's *secret* environment variables, not the plain ones.

**API**

| Variable | Value |
|---|---|
| `DATABASE_URL` 🔒 | `postgres://USER:PASSWORD@HOST:PORT/rdb?sslmode=require` |
| `WEB_URL` | `https://kellerkompass.de` |
| `API_PUBLIC_URL` | `https://api.kellerkompass.de` |
| `CORS_ORIGIN` | `https://kellerkompass.de` |
| `COOKIE_DOMAIN` | `kellerkompass.de` |
| `TRUST_PROXY` | `true` |
| `API_INTERNAL_TOKEN` 🔒 | `openssl rand -hex 32` — same value as on the web container |
| `EMAIL_PROVIDER` | `scaleway` |
| `SCALEWAY_SECRET_KEY` 🔒, `SCALEWAY_PROJECT_ID` | as in the local `.env` (TEM + Generative APIs key, not the deploy key) |
| `SCALEWAY_REGION` | `fr-par` (region of the verified TEM domain) |
| `EMAIL_FROM`, `EMAIL_FROM_NAME` | verified TEM sender |
| `VISION_MODEL` | `mistral-medium-3.5-128b` |
| `TEXT_MODEL` | optional; model for reading feed descriptions and scoring the fit of imported events, defaults to `VISION_MODEL` |
| `INGEST_CRON_SECRET` 🔒 | `openssl rand -hex 32` — without it `/internal/ingest/run` answers 404 |
| `S3_ENDPOINT`, `S3_REGION` | `https://s3.nl-ams.scw.cloud`, `nl-ams` |
| `S3_BUCKET` | the event images bucket (see below); without it events have no images |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` 🔒 | API key whose IAM policy has `ObjectStorageFullAccess` for the project |
| `IMAGE_BASE_URL` | `https://<bucket>.s3.nl-ams.scw.cloud` |

**Event images bucket.** Create an Object Storage bucket in `nl-ams` (Scaleway console → Object Storage →
Create bucket, visibility private: the API writes every object with a `public-read` ACL, so only the images
themselves are public, not the bucket listing). The API stores images under `events/<event id>/` with
immutable cache headers and deletes replaced ones. Commands run from a laptop against the production database
(`scripts/prod-db.sh …`, e.g. an ingest run) have no bucket credentials, so they leave images out; the next
run on the server adds them. `pnpm db:cli delete-event` cannot reach the bucket either: it prints the image's
key when the event had one, and that folder has to be deleted in the Scaleway console, or the image stays
public.

**Web**

| Variable | Value |
|---|---|
| `API_URL` | `https://api.kellerkompass.de` |
| `WEB_URL` | `https://kellerkompass.de` |
| `COOKIE_DOMAIN` | `kellerkompass.de` |
| `API_INTERNAL_TOKEN` 🔒 | same as the API |
| `BASIC_AUTH` 🔒 | `user:password` while the site isn't public yet |
| `SITE_NOINDEX` | `true` while the site isn't public yet |

## 3. Database

The API container applies pending migrations on every start (`dist/migrate.js`), so no manual migration
step is needed. Keep the API at max. 1 instance while a deploy with a new migration rolls out.

Accounts are created with the admin CLI from a laptop, pointed at the managed database (its public
endpoint must allow your IP). `scripts/prod-db.sh` reads host, port, user and database from `PROD_DB_*`
in the local `.env`, asks for the password and runs the given command with `DATABASE_URL` set:

```bash
scripts/prod-db.sh pnpm db:cli create-publisher "Letzte Welle" letzte-welle someone@example.org
scripts/prod-db.sh pnpm db:migrate
```

The feed-ingest migrations run `CREATE EXTENSION pg_trgm` (duplicate detection). On the managed database
the migrating user needs `CREATE` on the database for that; otherwise create the extension once as the
admin user before deploying.

## 4. Feed ingest cron

The API container gets a Scaleway cron trigger (container → Triggers → Create trigger, type CRON) that runs
every enabled ingest source once a day:

| Setting | Value |
|---|---|
| Name | `ingest-daily` |
| Schedule | `0 4 * * *` |
| Timezone | `Europe/Berlin` — 04:00 local time all year |
| Method, Path | `POST`, `/` |
| JSON body | `{"secret":"<INGEST_CRON_SECRET>"}` — one line, no trailing comma, or the form rejects it |
| HTTP headers | none |

The API serves the run at both `POST /` and `POST /internal/ingest/run` and reads the secret from the JSON
body or the `X-Ingest-Secret` header, so a trigger with path `/internal/ingest/run` and the header works just
as well. Check the wiring by sending the same request by hand (zsh); `read -s` keeps the secret out of the shell
history:

```bash
read -s "S?Secret: "
curl -X POST https://api.kellerkompass.de/ -H 'content-type: application/json' -d "{\"secret\":\"$S\"}"
```

It answers `{"data":{"skipped":false,"sources":[…]}}` with `"ok":true` per source; 404 means
`INGEST_CRON_SECRET` isn't set on the container (or it hasn't restarted yet), 403 a wrong secret. After the
first scheduled run, `pnpm db:cli ingest-list` (via `prod-db.sh`) shows the new `last run` time; the API
container log shows the request.

The run is synchronous inside the request: fetching every feed and extracting the times of new events can
take minutes, so it must finish within the container's request timeout. Do the first production run, which
extracts every upcoming event at once, from a laptop with the CLI instead:

```bash
scripts/prod-db.sh pnpm --filter @open-event-db/api ingest acud
```

**Fit scoring.** Every run ends with the fit-scoring pass: up to 200 open pending items, 4 LLM calls at a
time, inside the same request. Normally only the new items are scored (a few dozen), but a backfill is far
larger, so after the first deploy of this feature, and after every edit of
`packages/api/src/ingest/fit/taste.ts` or the fit prompt (`fit/prompt.ts`), run it once from the laptop
instead of waiting for the cron:

```bash
scripts/prod-db.sh pnpm --filter @open-event-db/api ingest:score
```

Repeat until it reports `scored: 0`; one run scores at most 200 items, `--limit N` changes that. The model is
`TEXT_MODEL`, else `VISION_MODEL`, with the Scaleway keys above; without a model, scoring is skipped and the
run result says `scoring: { skipped: 'no model' }`. The cron response carries the pass as its `scoring`
field. `ingest:score` exits 1 when another ingest run holds the lock, and 2 on bad arguments or a crash.

Sources are added with the admin CLI, for example the ones in production:

```bash
scripts/prod-db.sh pnpm db:cli ingest-add-source acud "ACUD macht neu" 'https://acudmachtneu.de/?eme_ical=public&scope={from}--{to}' kellerkompass-import --config '{"external_id_pattern":"-([0-9]+)@","extract_from_text":true,"rooms":["Club"],"venues":{"Club":"<venue id>"}}'
scripts/prod-db.sh pnpm db:cli ingest-add-source duncker "Dunckerclub" 'https://www.dunckerclub.de/start.html' kellerkompass-import --kind dunckerclub --config '{"venues":{"Dunckerclub":"<venue id>"}}'
scripts/prod-db.sh pnpm db:cli ingest-add-source badehaus "Badehaus Berlin" 'https://badehaus-berlin.com/events.ics' kellerkompass-import --config '{"default_location":"Badehaus","capped":true,"venues":{"Badehaus":"<venue id>"}}'
scripts/prod-db.sh pnpm db:cli ingest-add-source urbanspree "Urban Spree" 'https://www.urbanspree.com/program/?limit=100' kellerkompass-import --kind urbanspree --config '{"venues":{"Urban Spree":"<venue id>"}}'
scripts/prod-db.sh pnpm db:cli ingest-add-source berghain "Berghain" 'https://www.berghain.berlin/de/program/' kellerkompass-import --kind berghain --config '{"venues":{"Berghain":"<venue id>","Panorama Bar":"<venue id>","Säule":"<venue id>"}}'
scripts/prod-db.sh pnpm db:cli ingest-add-source kantine "Kantine am Berghain" 'https://www.berghain.berlin/de/program/kantine-am-berghain/' kellerkompass-import --kind berghain --config '{"venues":{"Kantine am Berghain":"<venue id>"}}'
scripts/prod-db.sh pnpm db:cli ingest-add-source slaughterhouse "Slaughterhouse" 'https://slaughterhouse-berlin.de/konzerte/' kellerkompass-import --kind slaughterhouse --config '{"venues":{"Slaughterhouse":"<venue id>"}}'
```

The Berghain sources must point at the German listings (`/de/program/…`): the adapter reads "tür"/"beginn"
and the "Abgesagt"/"Verschoben"/"Verlegt" title suffixes. An event's room is its first listed floor, so map
every floor to the Berghain venue; a night on another floor (Lab.oratory, Garten) without a mapping keeps
the floors as its location text. The same kind reads the Halle listing (`/de/program/halle/`), which is
empty most of the time. Running order, tickets and text are on the event pages, fetched one by one.

The Slaughterhouse page (WordPress) writes its programme as plain paragraphs: a date, the title in bold
("Party: Factory", the kind goes to the description), the text, a rule. There are no event pages or ids, so
the date is the id, as with the Dunckerclub; a second event on one day gets "-2". The start is "Beginn",
else the doors.

Urban Spree lists newest first, so `?limit=100` must reach back past today (the source fails with "raise
?limit=" otherwise). Descriptions are only on the detail pages: a run fetches one per upcoming event, one
after another, which takes about 40 seconds of the request timeout.

The Badehaus feed (WordPress Events Manager) has no LOCATION, hence `default_location`, and lists only the
next 50 events, hence `capped`: without it, an event pushed past the 50th by a newly added one would be
marked gone.

`extract_from_text` reads each new or changed event's text once: categories and links always, the times
only where the feed doesn't state them reliably (iCal; Urban Spree's placeholder times). Times the
Dunckerclub, Berghain and Urban Spree pages state stay as read. `default_categories` fills in when the text
names no category, e.g. `["party"]` for a club whose texts only list genres. Change an existing source's
config with `ingest-set-config`: the given keys replace the stored ones, the rest stays.

```bash
scripts/prod-db.sh pnpm db:cli ingest-set-config duncker --config '{"extract_from_text":true,"default_categories":["party"]}'
```

The next run reads every item stored before categories existed once more and syncs the categories into
accepted events. With `extract_from_text` newly set that is one extraction per stored item, so run it from
the laptop as above, not in the scheduled request.

**Lineups.** The Berghain/Kantine and Dunckerclub adapters write the lineup into its own field and leave it
out of the description. After the deploy that brought this, the next run reads every item stored before
lineups existed once more; events still synced from their feed take the lineup and the shorter
description then. With `extract_from_text` on (Duncker) that is one extraction per stored item, so run those
sources from the laptop first:

```bash
scripts/prod-db.sh pnpm --filter @open-event-db/api ingest berghain kantine duncker
```

Events whose lineup sits in the description as a Markdown list (the flyer import's `**Lineup**` list, or
`**Live**` / `**DJs**` groups typed by scouts) move over with a one-off script. Without `--write` it only
lists what it would do; check that list, then run it again with `--write`. Each moved event gets one history
entry (`via: cli`); events a feed keeps in sync are left to the feed.

```bash
scripts/prod-db.sh pnpm --filter @open-event-db/api lineup:backfill
scripts/prod-db.sh pnpm --filter @open-event-db/api lineup:backfill --write
```

Write patterns without backslashes (`[0-9]`, not `\d`): `pnpm` passes the arguments through a shell and
doubles every backslash, so `\d` arrives as `\\d` and the source fails with "external_id_pattern … yields no id".

The CLI picks up `SCALEWAY_SECRET_KEY`, `SCALEWAY_PROJECT_ID` and `TEXT_MODEL`/`VISION_MODEL` from the local
`.env`; `DATABASE_URL` from `prod-db.sh` takes precedence over the one in `.env`. A source with
`extract_from_text` fails with a clear `lastError` when text extraction isn't configured.

## 5. Domains

Add both custom domains to their containers in the Scaleway console (it issues the TLS certificates)
and create the CNAME records it shows at the DNS provider.

## Going public

Remove `BASIC_AUTH` and `SITE_NOINDEX` from the web container once imprint and privacy policy are online.
