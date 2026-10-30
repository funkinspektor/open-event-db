import { describe, expect, it } from 'vitest'
import type { EventDraft } from '@open-event-db/shared'
import { draftToPrefill, pickVenue, toLocalInput, venueQueries } from './draft'

const draft: EventDraft = {
  title: 'Metro Alien',
  start_date: '2026-10-23',
  starts_at: '2026-10-23T22:00:00+02:00',
  ends_at: null,
  venue_name: 'Dunckerclub',
  address: 'Dunckerstraße 64, 10439',
  city: 'Berlin',
  description: 'A night with synth and wave.',
  lineup: ['Der Schrauber', 'Bloodygrave'],
  categories: [],
  tags: ['goth', 'ebm', 'minimal wave'],
  links: { tickets: 'https://example.org/t' },
}

const v = (id: string, name: string) => ({ id, name, city: 'Berlin' })

describe('draftToPrefill', () => {
  it('splits tags into known (added) and new (suggested)', () => {
    const p = draftToPrefill(draft, ['techno', 'goth', 'ebm'])
    expect(p.tags).toEqual(['goth', 'ebm'])
    expect(p.suggestedTags).toEqual(['minimal wave'])
  })

  it('puts the lineup into the lineup field and leaves the description as read', () => {
    const p = draftToPrefill(draft, [])
    expect(p.description).toBe('A night with synth and wave.')
    expect(p.lineup).toEqual([
      {
        name: null,
        acts: [
          { name: 'Der Schrauber', time: null, live: false, note: null },
          { name: 'Bloodygrave', time: null, live: false, note: null },
        ],
      },
    ])
    expect(draftToPrefill({ ...draft, lineup: [], description: null }, []).lineup).toEqual([])
  })

  it('fills the date without a time when the image has none', () => {
    expect(draftToPrefill({ ...draft, starts_at: null }, [])).toMatchObject({ startDate: '2026-10-23', startTime: '' })
    expect(draftToPrefill({ ...draft, starts_at: null, start_date: null }, [])).toMatchObject({ startDate: '', startTime: '' })
    const [date, time] = toLocalInput(draft.starts_at).split('T')
    expect(draftToPrefill(draft, [])).toMatchObject({ startDate: date, startTime: time })
  })

  it('uses the address as location text only when there is no venue name', () => {
    expect(draftToPrefill(draft, []).locationText).toBe('')
    expect(draftToPrefill({ ...draft, venue_name: null }, []).locationText).toBe('Dunckerstraße 64, 10439')
  })

  it('turns links into editable rows', () => {
    expect(draftToPrefill(draft, []).links).toEqual([{ key: 'tickets', url: 'https://example.org/t' }])
  })
})

describe('venue matching', () => {
  it('also searches without a glued-on city', () => {
    expect(venueQueries('ModusBerlin')).toEqual(['ModusBerlin', 'Modus'])
    expect(venueQueries('RSO.BERLIN')).toEqual(['RSO.BERLIN', 'RSO'])
    expect(venueQueries('Berghain')).toEqual(['Berghain'])
  })

  it('pre-selects a single result', () => {
    expect(pickVenue('Dunckerclub', [v('1', 'Dunckerclub')]).venue?.id).toBe('1')
  })

  it('pre-selects the one exact name among several results', () => {
    const r = pickVenue('RSO.BERLIN', [v('1', 'RSO'), v('2', 'RSO Garten')])
    expect(r.venue?.id).toBe('1')
  })

  it('offers candidates when the match is ambiguous', () => {
    const r = pickVenue('Halle', [v('1', 'Halle 4'), v('2', 'Halle am Berghain')])
    expect(r.venue).toBeNull()
    expect(r.candidates).toHaveLength(2)
  })
})
