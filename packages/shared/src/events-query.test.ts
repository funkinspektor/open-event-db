import { describe, expect, it } from 'vitest'
import { eventListQuerySchema } from './events.js'

describe('eventListQuerySchema mine', () => {
  const mine = (v?: string) => eventListQuerySchema.safeParse(v === undefined ? {} : { mine: v })
  it('reads only true and 1 as true', () => {
    for (const v of ['true', '1']) expect(mine(v).data?.mine, v).toBe(true)
  })
  it('reads false, 0 and absent as false', () => {
    for (const v of ['false', '0']) expect(mine(v).data?.mine, v).toBe(false)
    expect(mine().data?.mine).toBeFalsy()
  })
  it('rejects anything else', () => {
    for (const v of ['yes', 'TRUE', '', '2', 'null']) expect(mine(v).success, v).toBe(false)
  })
})
