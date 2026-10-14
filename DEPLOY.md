# Deploying to Scaleway

Two containers plus a database, all in Amsterdam (`nl-ams`). Transactional Email and the Generative APIs
stay in `fr-par` (`SCALEWAY_REGION=fr-par`) — the API reaches both over HTTPS, so the region split
doesn't matter. (Managed PostgreSQL creation in `fr-par` was disabled on 2026-10-14.)

| Piece | Scaleway product | Public URL |
|---|---|---|
| Web (Next.js) | Serverless Container, port 3000 | `https://kellerkompass.de` |
| API (Fastify) | Serverless Container, port 3001 | `https://api.kellerkompass.de` |
| Postgres 16 | Managed Database for PostgreSQL | — |

Web and API run on sibling subdomains so the session cookie can be shared via `COOKIE_DOMAIN`.

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

## 4. Domains

Add both custom domains to their containers in the Scaleway console (it issues the TLS certificates)
and create the CNAME records it shows at the DNS provider.

## Going public

Remove `BASIC_AUTH` and `SITE_NOINDEX` from the web container once imprint and privacy policy are online.
