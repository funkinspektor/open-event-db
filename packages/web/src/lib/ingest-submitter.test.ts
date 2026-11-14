import { describe, expect, it } from 'vitest'
import { submitterLine } from './ingest-submitter'

const maria = { display_name: 'Maria', handle: 'maria', accepted: 4, decided: 5 }

describe('submitterLine', () => {
  it('shows the submitter with their record', () => {
    expect(submitterLine(maria)).toBe('Suggested by Maria (@maria) · 4 of 5 accepted')
  })
  it('says first suggestion when nothing was decided yet', () => {
    expect(submitterLine({ ...maria, accepted: 0, decided: 0 })).toBe('Suggested by Maria (@maria) · first suggestion')
  })
})
