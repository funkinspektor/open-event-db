import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { events, ingestItems, ingestSources, publishers, type IngestItem, type IngestSource, type Publisher } from '@open-event-db/db'
import { db } from '../../db.js'
import { fingerprint, subjectOf } from './prompt.js'
import { selectExamples, scorePending } from './score.js'
import { fitScoring, type FitScorer } from './scorer.js'

const stamp = Date.now()
const DAY = 86_400_000
let scout: Publisher
let source: IngestSource
let seq = 0

type Prompt = { system: string; user: string }

/** Stub model: "Wave" fits, "Indie" does not, anything else is a maybe. Records every call. */
function stubScorer(onCall?: (prompt: Prompt) => void | Promise<void>) {
  const calls: Prompt[] = []
  const scorer: FitScorer = {
    async score(prompt) {
      calls.push(prompt)
      await onCall?.(prompt)
      const verdict = prompt.user.includes('Wave') ? 'fit' : prompt.user.includes('Indie') ? 'no' : 'maybe'
      return { verdict, reason: `stub says ${verdict}` }
    },
  }
  fitScoring.setScorer(scorer)
  return calls
}

const draftOf = (title: string, startsAt: Date, endsAt: Date | null = null) => ({
  title,
  description: `${title} description`,
  starts_at: startsAt.toISOString(),
  ends_at: endsAt?.toISOString() ?? null,
  venue_id: null,
  location_text: 'Some Club',
  city: 'Berlin',
  categories: [],
  links: {},
  image_url: null,
  source_url: null,
  times_unverified: false,
})

async function addItem(
  title: string,
  fields: Partial<typeof ingestItems.$inferInsert> = {},
  draft: Record<string, unknown> = draftOf(title, new Date(Date.now() + 10 * DAY)),
  into: IngestSource = source,
): Promise<IngestItem> {
  const [item] = await db
    .insert(ingestItems)
    .values({ sourceId: into.id, externalId: `${title}-${++seq}`, draft, raw: title, contentHash: 'x', ...fields })
    .returning()
  return item!
}

const itemRow = async (id: string) => (await db.select().from(ingestItems).where(eq(ingestItems.id, id)))[0]!
const score = (opts: Parameters<typeof scorePending>[0] = {}) => scorePending({ only: [source.slug], ...opts })

beforeAll(async () => {
  const [p] = await db
    .insert(publishers)
    .values({
      name: 'Fit Scout',
      slug: `fit-scout-${stamp}`,
      email: `fit-scout-${stamp}@test.local`,
      verified: true,
      isPublisher: false,
      isScout: true,
    })
    .returning()
  scout = p!
})

// Every test starts with a fresh source so its items cannot leak into the next one
beforeEach(async () => {
  const slug = `fit-${stamp}-${++seq}`
  const [s] = await db
    .insert(ingestSources)
    .values({ slug, name: `Fit source ${seq}`, kind: 'ical', url: `https://${slug}.test/`, publisherId: scout.id })
    .returning()
  source = s!
})

afterEach(() => {
  fitScoring.reset()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await db.delete(ingestSources).where(eq(ingestSources.publisherId, scout.id))
  await db.delete(events).where(eq(events.createdBy, scout.id))
  await db.delete(publishers).where(eq(publishers.id, scout.id))
})

describe('scorePending', () => {
  it('scores new items and skips decided, gone, past and current ones', async () => {
    const calls = stubScorer()
    const wave = await addItem('Wave night')
    const indie = await addItem('Indie night')
    await addItem('Accepted night', { status: 'accepted' })
    await addItem('Rejected night', { status: 'rejected' })
    await addItem('Gone night', { goneAt: new Date() })
    await addItem('Past night', {}, draftOf('Past night', new Date(Date.now() - 3 * DAY), new Date(Date.now() - 2 * DAY)))
    const currentDraft = draftOf('Current night', new Date(Date.now() + 5 * DAY))
    const current = subjectOf(currentDraft as never, null, source.name)
    await addItem('Current night', { fitVerdict: 'fit', fitFingerprint: fingerprint(current) }, currentDraft)

    const result = await score()

    expect(result).toEqual({ scored: 2, fit: 1, maybe: 0, no: 1, failed: 0 })
    expect(calls).toHaveLength(2)
    expect(await itemRow(wave.id)).toMatchObject({ fitVerdict: 'fit', fitReason: 'stub says fit' })
    expect(await itemRow(indie.id)).toMatchObject({ fitVerdict: 'no', fitReason: 'stub says no' })
    const scored = await itemRow(wave.id)
    expect(scored.fitScoredAt).not.toBeNull()
    expect(scored.fitFingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('re-scores an item whose draft changed', async () => {
    const calls = stubScorer()
    const item = await addItem('Wave night')
    await score()
    expect((await itemRow(item.id)).fitVerdict).toBe('fit')

    await db
      .update(ingestItems)
      .set({ draft: draftOf('Indie night', new Date(Date.now() + 10 * DAY)) })
      .where(eq(ingestItems.id, item.id))
    const result = await score()

    expect(result).toMatchObject({ scored: 1, no: 1 })
    expect(calls).toHaveLength(2)
    expect((await itemRow(item.id)).fitVerdict).toBe('no')
    // and an unchanged item is left alone
    expect(await score()).toMatchObject({ scored: 0, failed: 0 })
    expect(calls).toHaveLength(2)
  })

  it('leaves the item untouched when the call fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let broken = true
    stubScorer((prompt) => {
      if (broken && prompt.user.includes('Wave')) throw new Error('provider down')
    })
    const wave = await addItem('Wave night')
    const indie = await addItem('Indie night')

    const result = await score()

    expect(result).toMatchObject({ scored: 1, no: 1, failed: 1 })
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ itemId: wave.id }))
    expect(await itemRow(wave.id)).toMatchObject({ fitVerdict: null, fitReason: null, fitScoredAt: null, fitFingerprint: null })
    expect((await itemRow(indie.id)).fitVerdict).toBe('no')

    broken = false
    expect(await score()).toMatchObject({ scored: 1, fit: 1, failed: 0 })
    expect((await itemRow(wave.id)).fitVerdict).toBe('fit')
  })

  it('skips an item with a broken draft and scores the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calls = stubScorer()
    const broken = await addItem('Broken', {}, { title: 'Broken', starts_at: new Date(Date.now() + DAY).toISOString() })
    const wave = await addItem('Wave night')

    const result = await score()

    expect(result).toEqual({ scored: 1, fit: 1, maybe: 0, no: 0, failed: 0 })
    expect(calls).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ itemId: broken.id }))
    expect((await itemRow(broken.id)).fitVerdict).toBeNull()
    expect((await itemRow(wave.id)).fitVerdict).toBe('fit')
  })

  it('does not overwrite an item decided while scoring', async () => {
    const item = await addItem('Wave night')
    stubScorer(async () => {
      await db.update(ingestItems).set({ status: 'rejected' }).where(eq(ingestItems.id, item.id))
    })

    const result = await score()

    expect(result).toMatchObject({ scored: 0, failed: 0 })
    expect(await itemRow(item.id)).toMatchObject({ status: 'rejected', fitVerdict: null, fitFingerprint: null })
  })

  it('caps a pass at the limit, soonest first', async () => {
    stubScorer()
    const late = await addItem('Late night', {}, draftOf('Late night', new Date(Date.now() + 30 * DAY)))
    const soon = await addItem('Soon night', {}, draftOf('Soon night', new Date(Date.now() + 2 * DAY)))
    const middle = await addItem('Middle night', {}, draftOf('Middle night', new Date(Date.now() + 9 * DAY)))

    const result = await score({ limit: 2 })

    expect(result.scored).toBe(2)
    expect((await itemRow(soon.id)).fitVerdict).not.toBeNull()
    expect((await itemRow(middle.id)).fitVerdict).not.toBeNull()
    expect((await itemRow(late.id)).fitVerdict).toBeNull()
  })

  it('never has more calls in flight than the concurrency', async () => {
    let inFlight = 0
    let peak = 0
    stubScorer(async () => {
      peak = Math.max(peak, ++inFlight)
      await new Promise((r) => setTimeout(r, 15))
      inFlight--
    })
    for (let i = 0; i < 5; i++) await addItem(`Night ${i}`)

    const result = await score({ concurrency: 2 })

    expect(result.scored).toBe(5)
    expect(peak).toBe(2)
  })

  it('passes the examples to the scorer', async () => {
    const calls = stubScorer()
    // decided far in the future so that it is among the latest decisions whatever else is in the database
    await addItem('Cold Wave Club', { status: 'accepted', decidedAt: new Date('2099-01-01T00:00:00Z') })
    await addItem('Wave night')

    await score()

    expect(calls).toHaveLength(1)
    expect(calls[0]!.system).toContain('Cold Wave Club')
  })

  it('reports a skipped pass without a model', async () => {
    fitScoring.setScorer(null)
    const item = await addItem('Wave night')

    expect(await score()).toEqual({ skipped: 'no model', scored: 0, fit: 0, maybe: 0, no: 0, failed: 0 })
    expect((await itemRow(item.id)).fitVerdict).toBeNull()
  })
})

describe('selectExamples', () => {
  it('drops rejects with duplicates and counts linked items as accepted', async () => {
    const decidedAt = new Date()
    await addItem('Accepted one', { status: 'accepted', decidedAt })
    const [event] = await db
      .insert(events)
      .values({ title: 'Linked one', startsAt: new Date(), locationText: 'Some Club', city: 'Berlin', links: {}, createdBy: scout.id })
      .returning()
    await addItem('Linked one', { status: 'accepted', decidedAt, eventId: event!.id })
    await addItem('Rejected one', { status: 'rejected', decidedAt })
    await addItem('Rejected duplicate', { status: 'rejected', decidedAt, hadDuplicates: true })

    const examples = await selectExamples({ only: [source.slug] })

    expect(examples.accepted.map((s) => s.title).sort()).toEqual(['Accepted one', 'Linked one'])
    expect(examples.rejected.map((s) => s.title)).toEqual(['Rejected one'])
    expect(examples.accepted[0]).toMatchObject({ source: source.name, place: 'Some Club' })
  })
})
