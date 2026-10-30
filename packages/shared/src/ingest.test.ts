import { describe, expect, it } from 'vitest'
import {
  duplicateQuerySchema,
  ingestGoneSchema,
  ingestItemViewSchema,
  ingestLinkSchema,
  ingestListQuerySchema,
  ingestRejectSchema,
  ingestSourceConfigSchema,
} from './ingest.js'

const uuid = '3f0c9a52-6d1e-4c43-9a3b-0d6a1f7e8b21'

describe('ingestSourceConfigSchema', () => {
  it('fills the defaults for an empty config', () => {
    expect(ingestSourceConfigSchema.parse({})).toEqual({
      timezone: 'Europe/Berlin',
      horizon_days: 180,
      external_id_pattern: null,
      venues: {},
      extract_from_text: false,
      city: 'Berlin',
      rooms: null,
      default_location: null,
      capped: false,
      default_categories: [],
      lineup_from_text: false,
    })
  })

  it('reads lineups from text only when the source asks for it', () => {
    expect(ingestSourceConfigSchema.parse({ lineup_from_text: true }).lineup_from_text).toBe(true)
  })

  it('accepts a list of rooms and rejects an empty one', () => {
    expect(ingestSourceConfigSchema.parse({ rooms: ['Club'] }).rooms).toEqual(['Club'])
    expect(() => ingestSourceConfigSchema.parse({ rooms: [] })).toThrow()
  })

  it('accepts a pattern that compiles and venue uuids', () => {
    const config = ingestSourceConfigSchema.parse({
      external_id_pattern: '^id-(\\d+)$',
      venues: { 'Hall A': uuid },
    })
    expect(config.external_id_pattern).toBe('^id-(\\d+)$')
    expect(config.venues).toEqual({ 'Hall A': uuid })
  })

  it('rejects a pattern that does not compile', () => {
    expect(() => ingestSourceConfigSchema.parse({ external_id_pattern: '(' })).toThrow()
  })

  it('rejects a venue mapping to a non-uuid', () => {
    expect(() => ingestSourceConfigSchema.parse({ venues: { 'Hall A': 'nope' } })).toThrow()
  })
})

describe('ingest request schemas', () => {
  it('rejects an empty or oversized reject list', () => {
    expect(() => ingestRejectSchema.parse({ ids: [] })).toThrow()
    expect(() => ingestRejectSchema.parse({ ids: Array(101).fill(uuid) })).toThrow()
    expect(ingestRejectSchema.parse({ ids: [uuid] })).toEqual({ ids: [uuid] })
  })

  it('defaults the list view to new and rejects unknown views', () => {
    expect(ingestListQuerySchema.parse({})).toEqual({ view: 'new', limit: 20 })
    expect(ingestListQuerySchema.parse({ view: 'gone', source: 'berghain', limit: '50' })).toEqual({
      view: 'gone',
      source: 'berghain',
      limit: 50,
    })
    expect(ingestListQuerySchema.parse({ view: 'filtered' }).view).toBe('filtered')
    expect(() => ingestListQuerySchema.parse({ view: 'all' })).toThrow()
  })

  it('validates link and gone bodies', () => {
    // A plain link takes nothing from the feed
    expect(ingestLinkSchema.parse({ event_id: uuid })).toEqual({ event_id: uuid, fields: [], links: [], sync: false })
    expect(() => ingestLinkSchema.parse({ event_id: 'x' })).toThrow()
    expect(() => ingestLinkSchema.parse({ event_id: uuid, fields: ['tags'] })).toThrow()
    expect(ingestGoneSchema.parse({ action: 'cancel' })).toEqual({ action: 'cancel' })
    expect(() => ingestGoneSchema.parse({ action: 'delete' })).toThrow()
  })

  it('requires starts_at on the duplicate query, everything else optional', () => {
    expect(() => duplicateQuerySchema.parse({})).toThrow()
    expect(duplicateQuerySchema.parse({ starts_at: '2026-11-01T20:00:00+01:00' })).toEqual({
      starts_at: '2026-11-01T20:00:00+01:00',
    })
  })
})

describe('ingestItemViewSchema', () => {
  it('parses a full item with a duplicate candidate', () => {
    const view = {
      id: uuid,
      status: 'pending',
      source: { slug: 'hall', name: 'Hall' },
      draft: {
        title: 'Concert',
        description: 'Verbatim text',
        lineup: [{ name: null, acts: [{ name: 'Act', time: null, live: true, note: null }] }],
        starts_at: '2026-11-01T20:00:00+01:00',
        ends_at: null,
        venue_id: null,
        location_text: 'Somewhere 1',
        city: 'Berlin',
        categories: ['concert'],
        links: {},
        image_url: null,
        source_url: 'https://example.org/e/1',
        times_unverified: true,
        lineup_from_text: true,
      },
      venue_name: null,
      gone_at: null,
      event_id: null,
      fit: { verdict: 'maybe', reason: 'Fine, but mainstream' },
      duplicates: [
        {
          id: uuid,
          title: 'Concert',
          starts_at: '2026-11-01T20:00:00+01:00',
          start_time_known: true,
          ends_at: null,
          venue_name: null,
          added_by_name: 'Scout',
          similarity: 0.5,
          likely: true,
        },
      ],
    }
    expect(ingestItemViewSchema.parse(view)).toEqual(view)
    expect(ingestItemViewSchema.parse({ ...view, fit: null }).fit).toBeNull()
    // A draft stored before lineups existed reads as one without
    const { lineup: _, ...olderDraft } = view.draft
    expect(ingestItemViewSchema.parse({ ...view, draft: olderDraft }).draft.lineup).toEqual([])
    // ... and one stored before the lineup step as not read
    const { lineup_from_text: __, ...unreadDraft } = view.draft
    expect(ingestItemViewSchema.parse({ ...view, draft: unreadDraft }).draft.lineup_from_text).toBe(false)
    expect(() => ingestItemViewSchema.parse({ ...view, fit: { verdict: 'great', reason: 'x' } })).toThrow()
  })
})
