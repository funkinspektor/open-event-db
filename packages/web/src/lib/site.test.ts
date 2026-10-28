import { describe, expect, it } from 'vitest'
import { shareMetadata } from './site'

describe('shareMetadata', () => {
  it('shares the event image when there is one', () => {
    const meta = shareMetadata('/events/x', 'Title', 'Desc', 'https://images.test/events/x/a.jpg')
    expect(meta.openGraph.images).toEqual([{ url: 'https://images.test/events/x/a.jpg' }])
    expect(meta.twitter.images).toEqual(['https://images.test/events/x/a.jpg'])
  })

  it('falls back to the site share image', () => {
    for (const meta of [shareMetadata('/events/x', 'Title', 'Desc'), shareMetadata('/events/x', 'Title', 'Desc', null)]) {
      expect(meta.openGraph.images).toEqual([expect.objectContaining({ url: '/opengraph-image', width: 1200 })])
      expect(meta.twitter.images).toEqual(['/opengraph-image'])
    }
  })
})
