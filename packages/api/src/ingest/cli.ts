import { runIngest } from './run.js'

// `pnpm --filter @open-event-db/api ingest [slug]` runs one source (enabled or not), or every enabled one
const slugs = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'))

const result = await runIngest(slugs.length ? { only: slugs } : {})
console.log(JSON.stringify(result, null, 2))
process.exit(result.skipped || result.sources.some((s) => !s.ok) ? 1 : 0)
