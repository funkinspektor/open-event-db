import { afterEach, describe, expect, it } from 'vitest'
import { fitJudgementSchema, fitScoring } from './scorer.js'

afterEach(() => fitScoring.reset())

describe('fitJudgementSchema', () => {
  it('cuts the reason to 200 characters', () => {
    expect(fitJudgementSchema.parse({ verdict: 'maybe', reason: 'x'.repeat(300) }).reason).toHaveLength(200)
  })

  it('trims the reason', () => {
    expect(fitJudgementSchema.parse({ verdict: 'fit', reason: '  Dark wave.  ' }).reason).toBe('Dark wave.')
  })

  it('rejects an empty or blank reason', () => {
    expect(() => fitJudgementSchema.parse({ verdict: 'no', reason: '   ' })).toThrow()
    expect(() => fitJudgementSchema.parse({ verdict: 'no', reason: '' })).toThrow()
  })

  it('rejects an unknown verdict', () => {
    expect(() => fitJudgementSchema.parse({ verdict: 'unsure', reason: 'x' })).toThrow()
  })
})

describe('fitScoring', () => {
  it('has no scorer under Vitest', () => {
    expect(fitScoring.scorer).toBeNull()
  })

  it('can swap and reset the scorer', () => {
    const stub = { score: async () => ({ verdict: 'fit' as const, reason: 'ok' }) }
    fitScoring.setScorer(stub)
    expect(fitScoring.scorer).toBe(stub)
    fitScoring.reset()
    expect(fitScoring.scorer).toBeNull()
  })
})
