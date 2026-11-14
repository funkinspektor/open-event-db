import { beforeAll, describe, expect, it, vi } from 'vitest'

const BUCKET = 'https://bucket.example/events/e1/a.jpg'
let mod: typeof import('./image-src')

beforeAll(async () => {
  vi.stubEnv('KK_IMAGE_HOSTS', 'bucket.example')
  mod = await import('./image-src')
})

describe('image-src', () => {
  it('resizes images from the configured host', () => {
    expect(mod.resized(BUCKET, 256)).toBe(`/_next/image?url=${encodeURIComponent(BUCKET)}&w=256&q=75`)
  })

  it('leaves other hosts and plain http alone', () => {
    expect(mod.resized('https://feed.example/x.jpg', 256)).toBe('https://feed.example/x.jpg')
    expect(mod.resized('http://bucket.example/x.jpg', 256)).toBe('http://bucket.example/x.jpg')
    expect(mod.thumbnailProps('http://localhost:3001/images/a.jpg', [128, 256, 384])).toEqual({
      src: 'http://localhost:3001/images/a.jpg',
    })
  })

  it('builds density and width srcsets', () => {
    const thumb = mod.thumbnailProps(BUCKET, [128, 256, 384])
    expect(thumb.srcSet).toMatch(/w=128&q=75 1x, .*w=256&q=75 2x, .*w=384&q=75 3x$/)
    const full = mod.responsiveImageProps(BUCKET, '420px')
    expect(full.sizes).toBe('420px')
    expect(full.srcSet).toMatch(/w=640&q=75 640w, .*w=1080&q=75 1080w, .*w=1920&q=75 1920w$/)
  })
})
