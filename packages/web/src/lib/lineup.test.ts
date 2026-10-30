import { describe, expect, it } from 'vitest'
import { fromLineupRows, parseLineupText, toLineupRows } from './lineup'

const row = (name: string, over: Partial<{ time: string; live: boolean; note: string }> = {}) => ({
  time: '',
  live: false,
  note: '',
  name,
  ...over,
})

describe('parseLineupText', () => {
  it('reads groups, times, live acts and notes as a venue lists them', () => {
    const text = 'Panorama Bar:\n22:00 Courtney Bailey b2b Hitomi – second circle\n04.30 Z@P (Live) – Cartulis Music\nSäule:\nTimnah'
    expect(parseLineupText(text)).toEqual([
      {
        name: 'Panorama Bar',
        acts: [
          row('Courtney Bailey b2b Hitomi', { time: '22:00', note: 'second circle' }),
          row('Z@P', { time: '04:30', live: true, note: 'Cartulis Music' }),
        ],
      },
      { name: 'Säule', acts: [row('Timnah')] },
    ])
  })

  it('puts lines before any heading into an unnamed group and skips blank lines', () => {
    expect(parseLineupText('Volcan\n\n  Dardo  \n')).toEqual([{ name: '', acts: [row('Volcan'), row('Dardo')] }])
  })

  it('splits off a note only at a spaced dash, so hyphenated names stay whole', () => {
    expect(parseLineupText('Jean-Michel - Label\nAnne-Clark')).toEqual([
      { name: '', acts: [row('Jean-Michel', { note: 'Label' }), row('Anne-Clark')] },
    ])
  })

  it('pads a one-digit hour', () => {
    expect(parseLineupText('7:00 Early Bird')[0]!.acts[0]!.time).toBe('07:00')
  })
})

describe('fromLineupRows', () => {
  it('drops rows without a name and groups left empty, and turns empty fields into null', () => {
    expect(
      fromLineupRows([
        { name: ' Live ', acts: [row(' Volcan ', { live: true }), row('', { time: '22:00' })] },
        { name: 'Empty', acts: [row('  ')] },
        { name: '', acts: [row('SVTVRA', { time: '01:00', note: ' IT ' })] },
      ]),
    ).toEqual([
      { name: 'Live', acts: [{ name: 'Volcan', time: null, live: true, note: null }] },
      { name: null, acts: [{ name: 'SVTVRA', time: '01:00', live: false, note: 'IT' }] },
    ])
  })

  it('reads an all-blank editor as no lineup', () => {
    expect(fromLineupRows([{ name: '', acts: [row('')] }])).toEqual([])
  })

  it('round-trips a stored lineup', () => {
    const lineup = [{ name: 'Säule', acts: [{ name: 'Timnah', time: '23:59', live: false, note: null }] }]
    expect(fromLineupRows(toLineupRows(lineup))).toEqual(lineup)
  })
})
