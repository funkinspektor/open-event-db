/**
 * Runs a folder of flyers/screenshots against one or more Scaleway vision models.
 *
 *   pnpm --filter @open-event-db/api eval:extract <folder> [--models a,b,c]
 *
 * Images are prepared like the web client does (tall captures cropped from the top to 1:2, then 1600px
 * long edge, JPEG); HEIC is converted with macOS sips. If the folder has an
 * `expected.json`, title / start / venue are scored against it:
 *
 *   { "flyer-01.jpg": { "title": "Keller Nacht", "start": "2026-10-17T23:00", "venue": "Halle 4" } }
 *
 * ("start" may also be a bare day, "2026-10-17"; leave a key out to skip that check, use null if the
 * image deliberately has no value.) Results are written to `<folder>/results-<timestamp>.json`.
 * Keep the folder outside the repo — the images belong to other people.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { EXTRACT_MAX_ASPECT, EXTRACT_MAX_EDGE_PX, type EventDraft } from '@open-event-db/shared'
import { normalizeExtraction } from './normalize.js'
import { scalewayVision } from './vision.js'

const DEFAULT_MODELS = ['pixtral-12b-2409', 'mistral-small-3.2-24b-instruct-2506', 'gemma-4-26b-a4b-it']
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif'])

interface Expected {
  title?: string | null
  start?: string | null
  venue?: string | null
}

type Check = boolean | null // null = not scored

interface Row {
  model: string
  file: string
  ms: number
  error?: string
  draft?: EventDraft
  checks?: { title: Check; start: Check; venue: Check }
}

const args = process.argv.slice(2)
const folderArg = args.find((a) => !a.startsWith('--'))
const modelsArg = args[args.indexOf('--models') + 1]
if (!folderArg) {
  console.error('Usage: pnpm --filter @open-event-db/api eval:extract <folder> [--models a,b,c]')
  process.exit(1)
}
const folder = resolve(process.env.INIT_CWD ?? process.cwd(), folderArg)
const models = args.includes('--models') && modelsArg ? modelsArg.split(',') : DEFAULT_MODELS

const { SCW_SECRET_KEY, SCW_DEFAULT_PROJECT_ID } = process.env
if (!SCW_SECRET_KEY || !SCW_DEFAULT_PROJECT_ID) {
  console.error('SCW_SECRET_KEY and SCW_DEFAULT_PROJECT_ID must be set (repo-root .env)')
  process.exit(1)
}

const loose = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const compact = (s: string) => loose(s).replace(/ /g, '')

/** Berlin wall-clock "YYYY-MM-DDTHH:MM" of a draft, as people would write it in expected.json. */
const draftStart = (d: EventDraft) => d.starts_at?.slice(0, 16) ?? d.start_date

function score(draft: EventDraft, exp: Expected | undefined): Row['checks'] {
  const check = (key: keyof Expected, actual: string | null, compare: (a: string, e: string) => boolean): Check => {
    if (!exp || !(key in exp)) return null
    const expected = exp[key]
    if (expected === null || expected === undefined) return actual === null
    return actual !== null && compare(actual, expected)
  }
  return {
    // Extra words around the expected title ("… | Venue – Berlin") count as right; spacing and punctuation don't matter
    title: check('title', draft.title, (a, e) => compact(a).includes(compact(e))),
    start: check('start', draftStart(draft), (a, e) => (e.length === 10 ? a.startsWith(e) : a === e)),
    venue: check('venue', draft.venue_name, (a, e) => compact(a) === compact(e)),
  }
}

/** iPhone photos: sharp's prebuilt libvips can't decode HEVC, so let macOS convert them first. */
async function heicToJpeg(path: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'oedb-eval-'))
  try {
    const out = join(dir, 'image.jpg')
    await promisify(execFile)('sips', ['-s', 'format', 'jpeg', path, '--out', out])
    return await readFile(out)
  } catch (err) {
    throw new Error(`Could not convert ${path} (HEIC needs macOS sips): ${(err as Error).message}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function loadImage(path: string): Promise<Buffer> {
  const isHeic = /\.hei[cf]$/i.test(path)
  // Bake in EXIF orientation first (like the browser does) so width/height below are the visible ones
  const upright = await sharp(isHeic ? await heicToJpeg(path) : await readFile(path)).rotate().toBuffer()
  const { width = 0, height = 0 } = await sharp(upright).metadata()
  const maxHeight = Math.round(width * EXTRACT_MAX_ASPECT)
  return sharp(upright)
    .extract({ left: 0, top: 0, width, height: Math.min(height, maxHeight) })
    .resize(EXTRACT_MAX_EDGE_PX, EXTRACT_MAX_EDGE_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
}

const mark = (c: Check) => (c === null ? '·' : c ? '✓' : '✗')

async function main() {
  const files = (await readdir(folder)).filter((f) => IMAGE_EXT.has(extname(f).toLowerCase())).sort()
  if (!files.length) throw new Error(`No PNG/JPEG/WEBP/HEIC images in ${folder}`)
  const expected: Record<string, Expected> = await readFile(join(folder, 'expected.json'), 'utf8')
    .then((s) => JSON.parse(s) as Record<string, Expected>)
    .catch(() => ({}))
  const images = new Map(await Promise.all(files.map(async (f) => [f, await loadImage(join(folder, f))] as const)))

  console.log(`${files.length} images, ${Object.keys(expected).length} with expectations, models: ${models.join(', ')}\n`)
  const rows: Row[] = []

  for (const model of models) {
    const extractor = scalewayVision({ secretKey: SCW_SECRET_KEY!, projectId: SCW_DEFAULT_PROJECT_ID!, model, timeoutMs: 60_000 })
    console.log(`── ${model}`)
    for (const file of files) {
      const t0 = performance.now()
      const row: Row = { model, file, ms: 0 }
      try {
        const extraction = await extractor.extract({ data: images.get(file)!, type: 'image/jpeg' })
        row.draft = normalizeExtraction(extraction, new Date())
        row.checks = score(row.draft, expected[file])
      } catch (err) {
        row.error = (err as Error).message
      }
      row.ms = Math.round(performance.now() - t0)
      rows.push(row)

      const d = row.draft
      const c = row.checks
      console.log(
        row.error
          ? `  ${file}  ${row.ms}ms  ERROR ${row.error.slice(0, 160)}`
          : `  ${file}  ${row.ms}ms\n` +
              `    ${mark(c!.title)} title  ${d!.title ?? '—'}\n` +
              `    ${mark(c!.start)} start  ${draftStart(d!) ?? '—'}${d!.ends_at ? ` → ${d!.ends_at.slice(0, 16)}` : ''}\n` +
              `    ${mark(c!.venue)} venue  ${d!.venue_name ?? '—'}`,
      )
    }
    console.log()
  }

  console.log('── Summary')
  for (const model of models) {
    const mine = rows.filter((r) => r.model === model)
    const ok = mine.filter((r) => !r.error)
    const scored = ok.filter((r) => r.checks && Object.values(r.checks).some((c) => c !== null))
    const allRight = scored.filter((r) => Object.values(r.checks!).every((c) => c !== false))
    const avg = ok.length ? Math.round(ok.reduce((s, r) => s + r.ms, 0) / ok.length) : 0
    const max = ok.length ? Math.max(...ok.map((r) => r.ms)) : 0
    console.log(
      `  ${model.padEnd(40)} errors ${mine.length - ok.length}/${mine.length}` +
        `  title+start+venue right ${allRight.length}/${scored.length}` +
        `  latency avg ${avg}ms max ${max}ms`,
    )
  }

  const out = join(folder, `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  await writeFile(out, JSON.stringify(rows, null, 2))
  console.log(`\nDetails: ${out}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
