import { backfillMarkdownLineups } from './backfill.js'

// `pnpm --filter @open-event-db/api lineup:backfill [--write]` lists the events whose Markdown lineup would move
// into the lineup field; with --write it moves them. Exit codes: 0 done, 2 bad arguments or a crash.
const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'))
const unknown = args.filter((a) => a !== '--write')
if (unknown.length) {
  console.error(`Unknown argument: ${unknown.join(' ')}. Usage: lineup:backfill [--write]`)
  process.exit(2)
}
const write = args.includes('--write')

try {
  const changes = await backfillMarkdownLineups({ write })
  for (const c of changes) {
    console.log(`\n${c.id}  ${c.title}`)
    for (const g of c.lineup) console.log(`  ${g.name ?? '(no group)'}: ${g.acts.map((a) => a.name).join(', ')}`)
    console.log(`  description now: ${JSON.stringify(c.description.slice(0, 160))}${c.description.length > 160 ? '…' : ''}`)
  }
  console.log(`\n${changes.length} event(s) ${write ? 'moved' : 'would move (dry run; add --write to move them)'}`)
  process.exit(0)
} catch (err) {
  console.error(err)
  process.exit(2)
}
