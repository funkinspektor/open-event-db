import { describe, expect, it } from 'vitest'
import { canCancel, canEdit, canManageOwners } from './permissions.js'

const scout = { id: 's', is_scout: true }
const publisher = { id: 'p', is_scout: false }
const coOwner = { id: 'c', is_scout: false }

const unclaimed = { owners: [] }
const claimed = {
  owners: [
    { publisher_id: 'p', role: 'creator' as const },
    { publisher_id: 'c', role: 'co_owner' as const },
  ],
}

describe('event permissions', () => {
  it('unclaimed events: any scout may edit and cancel, publishers may not', () => {
    expect(canEdit(unclaimed, scout)).toBe(true)
    expect(canCancel(unclaimed, scout)).toBe(true)
    expect(canEdit(unclaimed, publisher)).toBe(false)
    expect(canCancel(unclaimed, publisher)).toBe(false)
    expect(canManageOwners(unclaimed, scout)).toBe(false)
  })

  it('claimed events: owners edit, only the creator cancels and manages owners, scouts are out', () => {
    expect(canEdit(claimed, publisher)).toBe(true)
    expect(canEdit(claimed, coOwner)).toBe(true)
    expect(canCancel(claimed, publisher)).toBe(true)
    expect(canCancel(claimed, coOwner)).toBe(false)
    expect(canManageOwners(claimed, publisher)).toBe(true)
    expect(canManageOwners(claimed, coOwner)).toBe(false)
    expect(canEdit(claimed, scout)).toBe(false)
    expect(canCancel(claimed, scout)).toBe(false)
  })
})
