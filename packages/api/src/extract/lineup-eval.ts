/**
 * Runs the lineup cases against one or more Scaleway text models.
 *
 *   pnpm --filter @open-event-db/api eval:lineup [--models a,b]
 *
 * Each case in `lineup-eval/cases.json` is a venue's event text with the lineup a person reads in it. Acts are
 * matched by name (case, whitespace and Markdown don't count), groups are ignored. Per model it prints
 * recall (expected acts found), precision (returned acts that were expected) and live accuracy, then the
 * cases that went wrong. Results go to `lineup-eval/results-<timestamp>.json` (gitignored).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Lineup } from '@open-event-db/shared'
import { normalizeForMatch, scalewayLineup } from './lineup.js'

export interface CaseScore {
  expected: number
  found: number
  returned: number
  correct: number
  liveRight: number
}

interface EvalCase {
  id: string
  source: string
  text: string
  expected: Lineup
}

const actsOf = (lineup: Lineup) => lineup.flatMap((g) => g.acts).map((a) => ({ key: normalizeForMatch(a.name), live: a.live }))

export function scoreCase(expected: Lineup, got: Lineup): CaseScore {
  const want = actsOf(expected)
  const have = actsOf(got)
  const matched = want.filter((w) => have.some((h) => h.key === w.key))
  return {
    expected: want.length,
    found: matched.length,
    returned: have.length,
    correct: have.filter((h) => want.some((w) => w.key === h.key)).length,
    liveRight: matched.filter((w) => have.find((h) => h.key === w.key)!.live === w.live).length,
  }
}

const pct = (n: number, d: number) => (d === 0 ? '100.0' : ((100 * n) / d).toFixed(1))

async function main() {
  const args = process.argv.slice(2)
  const modelsArg = args[args.indexOf('--models') + 1]
  const { SCALEWAY_SECRET_KEY, SCALEWAY_PROJECT_ID, TEXT_MODEL, VISION_MODEL } = process.env
  const models = args.includes('--models') && modelsArg ? modelsArg.split(',') : [TEXT_MODEL || VISION_MODEL || '']
  if (!SCALEWAY_SECRET_KEY || !SCALEWAY_PROJECT_ID || !models[0]) {
    console.error('SCALEWAY_SECRET_KEY, SCALEWAY_PROJECT_ID and TEXT_MODEL (or VISION_MODEL / --models) must be set (repo-root .env)')
    process.exit(1)
  }

  const dir = fileURLToPath(new URL('./lineup-eval/', import.meta.url))
  const cases = JSON.parse(await readFile(`${dir}cases.json`, 'utf8')) as EvalCase[]
  const results: Record<string, unknown>[] = []

  for (const model of models) {
    const reader = scalewayLineup({ secretKey: SCALEWAY_SECRET_KEY, projectId: SCALEWAY_PROJECT_ID, model, timeoutMs: 60_000 })
    const total: CaseScore = { expected: 0, found: 0, returned: 0, correct: 0, liveRight: 0 }
    const misses: string[] = []
    let failed = 0
    for (const c of cases) {
      const started = Date.now()
      let got: Lineup
      try {
        got = await reader.read(c.text)
      } catch (err) {
        failed++
        misses.push(`  ${c.id}: failed (${(err as Error).message})`)
        results.push({ model, id: c.id, error: (err as Error).message })
        continue
      }
      const s = scoreCase(c.expected, got)
      for (const k of Object.keys(total) as (keyof CaseScore)[]) total[k] += s[k]
      results.push({ model, id: c.id, ms: Date.now() - started, score: s, got })
      if (s.found < s.expected || s.correct < s.returned || s.liveRight < s.found) {
        const names = (l: Lineup) => actsOf(l).map((a) => `${a.key}${a.live ? ' (live)' : ''}`).join(', ') || '—'
        misses.push(`  ${c.id}\n    expected: ${names(c.expected)}\n    got:      ${names(got)}`)
      }
    }
    console.log(
      `\n${model}: recall ${pct(total.found, total.expected)}% · precision ${pct(total.correct, total.returned)}% · live ${pct(total.liveRight, total.found)}% · ${failed} failed of ${cases.length}`,
    )
    if (misses.length) console.log(misses.join('\n'))
  }

  const out = `${dir}results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  await writeFile(out, JSON.stringify(results, null, 2))
  console.log(`\nResults: ${out}`)
}

// Only as a script: the tests import scoreCase without running the eval
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
