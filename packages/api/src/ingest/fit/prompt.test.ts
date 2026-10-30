import { describe, expect, it } from 'vitest'
import type { IngestDraft } from '@open-event-db/shared'
import { buildPrompt, fingerprint, subjectOf, type FitSubject } from './prompt.js'

const draft = (over: Partial<IngestDraft> = {}): IngestDraft => ({
  title: 'Dark Wave Night',
  description: 'A night of dark wave.',
  starts_at: '2026-11-07T22:00:00.000Z',
  ends_at: null,
  venue_id: null,
  location_text: 'Somewhere 1',
  city: 'Berlin',
  categories: ['party'],
  links: {},
  image_url: null,
  source_url: null,
  times_unverified: false,
  ...over,
})

const subject = (over: Partial<FitSubject> = {}): FitSubject => ({
  title: 'Dark Wave Night',
  place: 'Badehaus',
  source: 'badehaus',
  starts_at: '2026-11-07T22:00:00.000Z',
  categories: ['party'],
  description: 'A night of dark wave.',
  ...over,
})

describe('subjectOf', () => {
  it('cuts a long description to 1,500 characters', () => {
    expect(subjectOf(draft({ description: 'x'.repeat(3000) }), null, 'src').description).toHaveLength(1500)
  })

  it('collapses whitespace in the description', () => {
    expect(subjectOf(draft({ description: 'a \n\n  b\t c' }), null, 'src').description).toBe('a b c')
  })

  it('prefers the venue name over location_text', () => {
    expect(subjectOf(draft(), 'Badehaus', 'src').place).toBe('Badehaus')
    expect(subjectOf(draft(), null, 'src').place).toBe('Somewhere 1')
    expect(subjectOf(draft({ location_text: null }), null, 'src').place).toBeNull()
  })

  it('carries source name, start and categories', () => {
    expect(subjectOf(draft(), null, 'Badehaus feed')).toMatchObject({
      source: 'Badehaus feed',
      starts_at: '2026-11-07T22:00:00.000Z',
      categories: ['party'],
    })
  })
})

describe('fingerprint', () => {
  it('is identical for equal subjects and changes with the title', () => {
    expect(fingerprint(subject())).toBe(fingerprint(subject()))
    expect(fingerprint(subject())).not.toBe(fingerprint(subject({ title: 'Other' })))
    expect(fingerprint(subject())).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('buildPrompt', () => {
  it('lists accepted examples and omits the empty rejected list', () => {
    const a = subject({ title: 'Accepted Night' })
    const { system } = buildPrompt(subject(), { accepted: [a], rejected: [] })
    expect(system).toContain('Accepted Night')
    expect(system).toContain('Recently accepted by the editors:')
    expect(system).not.toContain('Recently rejected')
  })

  it('lists rejected examples with unknown place and a 150-character description', () => {
    const r = subject({ title: 'Indie Disco', place: null, description: 'y'.repeat(400) })
    const { system } = buildPrompt(subject(), { accepted: [], rejected: [r] })
    expect(system).toContain('Recently rejected by the editors:')
    expect(system).toContain(`- Indie Disco | unknown place | ${'y'.repeat(150)}`)
    expect(system).not.toContain('y'.repeat(151))
  })

  it('puts the subject fields into the user message', () => {
    const { user } = buildPrompt(subject(), { accepted: [], rejected: [] })
    expect(user).toContain('Title: Dark Wave Night')
    expect(user).toContain('Place: Badehaus')
  })

  it('does not change the fingerprint of the subject', () => {
    const s = subject()
    const before = fingerprint(s)
    buildPrompt(s, { accepted: [subject({ title: 'A' })], rejected: [subject({ title: 'B' })] })
    expect(fingerprint(s)).toBe(before)
  })

  it('builds a prompt for an empty description', () => {
    expect(() => buildPrompt(subject({ description: '' }), { accepted: [], rejected: [] })).not.toThrow()
  })
})
