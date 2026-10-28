import { describe, expect, it } from 'vitest'
import { imageRemovalNotice } from './images.js'

describe('imageRemovalNotice', () => {
  it('names the object and its folder for an event with an image', () => {
    const notice = imageRemovalNotice('events/e1/abc.jpg')
    expect(notice).toContain('events/e1/abc.jpg')
    expect(notice).toContain('events/e1/')
    expect(notice).toMatch(/still public/)
  })

  it('says nothing for an event without one', () => {
    expect(imageRemovalNotice(null)).toBeNull()
  })
})
