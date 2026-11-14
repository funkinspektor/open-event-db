import { runIngest, type IngestRunResult, type RunIngestOptions } from './run.js'

type Run = (opts: RunIngestOptions) => Promise<IngestRunResult>

interface Log {
  log(line: string): void
  error(line: string): void
}

/**
 * One run of the daily feed ingest as a Scaleway Serverless Job (see `ingest-job.ts`): every enabled source,
 * or the slugs given as arguments. Returns the exit code.
 *
 * Exit 0 whenever the run itself went through, like the former cron endpoint's 200: a failing source is
 * recorded on the source (`lastError`) and logged, but doesn't fail the job, so one flaky venue site doesn't
 * turn every run red. A run skipped because another one holds the ingest lock is logged and exits 0 too.
 * Exit 1 only when the run crashes (database unreachable, a bug), so the job run shows as failed.
 */
export async function runIngestJob(slugs: string[], run: Run = runIngest, out: Log = console): Promise<number> {
  const started = Date.now()
  let result: IngestRunResult
  try {
    result = await run(slugs.length ? { only: slugs } : {})
  } catch (err) {
    out.error(`ingest run crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    return 1
  }
  if (result.skipped) {
    out.log('ingest run skipped: another run holds the ingest lock')
    return 0
  }
  for (const s of result.sources) {
    if (!s.ok) out.error(`ingest source ${s.slug} failed: ${s.error ?? 'unknown error'}`)
  }
  const failed = result.sources.filter((s) => !s.ok).length
  const seconds = Math.round((Date.now() - started) / 1000)
  out.log(`ingest run done in ${seconds} s: ${result.sources.length} sources, ${failed} failed`)
  out.log(JSON.stringify(result))
  return 0
}
