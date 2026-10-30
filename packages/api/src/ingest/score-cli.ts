import { scorePending } from './fit/score.js'
import { withIngestLock } from './run.js'

// `pnpm --filter @open-event-db/api ingest:score [--limit N] [slug ...]` scores the open items of one source
// (or of every source) without fetching feeds, e.g. to catch up after the scoring model was configured.
const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'))
const slugs: string[] = []
let limit: number | undefined
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit') {
    limit = Number(args[++i])
    if (!Number.isInteger(limit) || limit < 1) {
      console.error('--limit needs a positive whole number')
      process.exit(2)
    }
  } else {
    slugs.push(args[i]!)
  }
}

// Exit codes: 0 done, 1 another ingest run holds the lock, 2 bad arguments or a crash.
let result: Awaited<ReturnType<typeof scorePending>> | null
try {
  result = await withIngestLock(() => scorePending({ only: slugs.length ? slugs : undefined, limit }))
} catch (err) {
  console.error(err)
  process.exit(2)
}
if (result === null) console.error('Another ingest run holds the lock; nothing scored.')
console.log(JSON.stringify(result ?? { skipped: true }, null, 2))
process.exit(result === null ? 1 : 0)
