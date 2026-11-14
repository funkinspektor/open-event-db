import { describe, expect, it } from 'vitest'
import type { IngestRunResult, RunIngestOptions, SourceRunResult } from './run.js'
import { runIngestJob } from './job.js'

const source = (slug: string, ok = true, error?: string): SourceRunResult => ({
  slug,
  ok,
  ...(error ? { error } : {}),
  seen: 1,
  created: 0,
  updated: 0,
  synced: 0,
  gone: 0,
})

function capture() {
  const lines: string[] = []
  const errors: string[] = []
  return { lines, errors, out: { log: (l: string) => lines.push(l), error: (l: string) => errors.push(l) } }
}

// The real pipeline (and its advisory lock) stays out of these tests: run.test.ts covers it
describe('runIngestJob', () => {
  it('runs every enabled source without arguments and exits 0', async () => {
    const calls: RunIngestOptions[] = []
    const { lines, errors, out } = capture()
    const result: IngestRunResult = { skipped: false, sources: [source('acud'), source('duncker')] }
    const code = await runIngestJob([], async (opts) => (calls.push(opts), result), out)
    expect(code).toBe(0)
    expect(calls).toEqual([{}])
    expect(errors).toEqual([])
    expect(lines[0]).toMatch(/^ingest run done in \d+ s: 2 sources, 0 failed$/)
    expect(JSON.parse(lines[1]!)).toEqual(result)
  })

  it('passes slugs on as `only`', async () => {
    const calls: RunIngestOptions[] = []
    const code = await runIngestJob(['berghain', 'kantine'], async (opts) => {
      calls.push(opts)
      return { skipped: false, sources: [] }
    }, capture().out)
    expect(code).toBe(0)
    expect(calls).toEqual([{ only: ['berghain', 'kantine'] }])
  })

  it('logs failed sources as errors but still exits 0', async () => {
    const { lines, errors, out } = capture()
    const code = await runIngestJob(
      [],
      async () => ({ skipped: false, sources: [source('acud'), source('lido', false, 'HTTP 503')] }),
      out,
    )
    expect(code).toBe(0)
    expect(errors).toEqual(['ingest source lido failed: HTTP 503'])
    expect(lines[0]).toMatch(/2 sources, 1 failed$/)
  })

  it('exits 0 when another run holds the lock', async () => {
    const { lines, out } = capture()
    expect(await runIngestJob([], async () => ({ skipped: true, sources: [] }), out)).toBe(0)
    expect(lines).toEqual(['ingest run skipped: another run holds the ingest lock'])
  })

  it('exits 1 when the run crashes', async () => {
    const { errors, out } = capture()
    const code = await runIngestJob([], async () => {
      throw new Error('connect ECONNREFUSED')
    }, out)
    expect(code).toBe(1)
    expect(errors[0]).toContain('ingest run crashed')
    expect(errors[0]).toContain('connect ECONNREFUSED')
  })
})
