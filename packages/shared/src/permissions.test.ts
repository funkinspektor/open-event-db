import { describe, expect, it } from 'vitest'
import { actorRole, canCancel, canEdit, canManageOrganizers } from './permissions.js'

const ORG = 'org-creator'
const CO = 'org-cohost'

const scout = { id: 's', is_scout: true, organizer_ids: [] as string[] }
const creator = { id: 'p', is_scout: false, organizer_ids: [ORG] }
const coHost = { id: 'c', is_scout: false, organizer_ids: [CO] }

const unclaimed = { organizers: [] }
const claimed = {
  organizers: [
    { organizer_id: ORG, role: 'creator' as const },
    { organizer_id: CO, role: 'co_host' as const },
  ],
}

describe('event permissions', () => {
  it('unclaimed events: any scout may edit and cancel, organizer members may not', () => {
    expect(canEdit(unclaimed, scout)).toBe(true)
    expect(canCancel(unclaimed, scout)).toBe(true)
    expect(canEdit(unclaimed, creator)).toBe(false)
    expect(canCancel(unclaimed, creator)).toBe(false)
    expect(canManageOrganizers(unclaimed, scout)).toBe(false)
  })

  it('claimed events: members edit, only the creator organizer cancels and manages organizers, scouts are out', () => {
    expect(canEdit(claimed, creator)).toBe(true)
    expect(canEdit(claimed, coHost)).toBe(true)
    expect(canCancel(claimed, creator)).toBe(true)
    expect(canCancel(claimed, coHost)).toBe(false)
    expect(canManageOrganizers(claimed, creator)).toBe(true)
    expect(canManageOrganizers(claimed, coHost)).toBe(false)
    expect(canEdit(claimed, scout)).toBe(false)
    expect(canCancel(claimed, scout)).toBe(false)
  })

  it('a member of both creator and co-host organizers counts as creator', () => {
    const actor = { id: 'a', is_scout: false, organizer_ids: [CO, ORG] }
    expect(actorRole(claimed, actor)).toBe('creator')
    expect(canCancel(claimed, actor)).toBe(true)
  })

  it('an actor without matching organizers cannot edit a claimed event, even as scout', () => {
    expect(canEdit(claimed, { id: 's', is_scout: true, organizer_ids: [] })).toBe(false)
  })

  it('an actor without organizers or scout flag can do nothing', () => {
    const plain = { id: 'p', is_scout: false, organizer_ids: [] }
    expect(canEdit(unclaimed, plain)).toBe(false)
    expect(canCancel(unclaimed, plain)).toBe(false)
  })
})
