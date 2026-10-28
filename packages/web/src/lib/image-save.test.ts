import { describe, expect, it } from 'vitest'
import { imageSaveOutcome, savedParam } from './image-save'

describe('imageSaveOutcome', () => {
  it('tells a server without image storage from a failed upload', () => {
    expect(imageSaveOutcome(200, undefined)).toBe('saved')
    expect(imageSaveOutcome(503, 'images_unavailable')).toBe('unavailable')
    expect(imageSaveOutcome(503, 'internal')).toBe('failed')
    expect(imageSaveOutcome(413, 'payload_too_large')).toBe('failed')
  })
})

describe('savedParam', () => {
  it('names the message the event page shows', () => {
    expect(savedParam('create', 'saved')).toBe('created')
    expect(savedParam('edit', 'saved')).toBe('updated')
    expect(savedParam('edit', 'failed')).toBe('updated_image_failed')
    expect(savedParam('create', 'unavailable')).toBe('created_image_unavailable')
  })
})
