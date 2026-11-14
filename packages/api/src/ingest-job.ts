// Entry point of the ingest Serverless Job (see DEPLOY.md, "Feed ingest job"). Same image as the API, started
// with `node dist/ingest-job.js [slug …]` instead of the server, so the daily ingest never runs inside the
// container that serves the public API. It doesn't migrate: the API container owns the migrations.
import { runIngestJob } from './ingest/job.js'

const slugs = process.argv.slice(2).filter((a) => a !== '--')
process.exit(await runIngestJob(slugs))
