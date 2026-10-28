import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { EVENT_IMAGE_MAX_BYTES } from '@open-event-db/shared'
import { buildApp } from '../app.js'
import { fetchRemoteImage } from './fetch.js'
import { sniffImageType } from './sniff.js'
import { imageKey, imageStore, localImageStore, s3ImageStore } from './store.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')])

afterEach(() => imageStore.reset())

describe('sniffImageType', () => {
  it('reads the type from the file signature', () => {
    expect(sniffImageType(PNG)).toBe('image/png')
    expect(sniffImageType(JPEG)).toBe('image/jpeg')
    expect(sniffImageType(WEBP)).toBe('image/webp')
    expect(sniffImageType(Buffer.from('<html>'))).toBeNull()
  })
})

describe('imageKey', () => {
  it('puts a random name with the type extension under the event', () => {
    expect(imageKey('e1', 'image/jpeg')).toMatch(/^events\/e1\/[0-9a-f-]{36}\.jpg$/)
    expect(imageKey('e1', 'image/png')).toMatch(/\.png$/)
    expect(imageKey('e1', 'image/webp')).toMatch(/\.webp$/)
  })
})

describe('s3ImageStore', () => {
  const cfg = {
    endpoint: 'https://s3.test',
    region: 'fr-par',
    bucket: 'bucket',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secret',
    baseUrl: 'https://cdn.test/',
  }

  function recording(status = 200) {
    const calls: Request[] = []
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push(new Request(input, init))
      return new Response(null, { status })
    }) as typeof fetch
    return { calls, fetchImpl }
  }

  it('puts a public, immutable object with a signed request', async () => {
    const { calls, fetchImpl } = recording()
    await s3ImageStore(cfg, fetchImpl).put('events/x.jpg', JPEG, 'image/jpeg')
    const [req] = calls
    expect(req!.method).toBe('PUT')
    expect(req!.url).toBe('https://s3.test/bucket/events/x.jpg')
    expect(req!.headers.get('content-type')).toBe('image/jpeg')
    expect(req!.headers.get('x-amz-acl')).toBe('public-read')
    expect(req!.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(req!.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /)
  })

  it('deletes the object at the same URL', async () => {
    const { calls, fetchImpl } = recording(204)
    await s3ImageStore(cfg, fetchImpl).delete('events/x.jpg')
    expect(calls.map((r) => [r.method, r.url])).toEqual([['DELETE', 'https://s3.test/bucket/events/x.jpg']])
  })

  it('builds public URLs from the base URL', () => {
    expect(s3ImageStore(cfg).url('events/x.jpg')).toBe('https://cdn.test/events/x.jpg')
  })

  it('fails a put the bucket refuses', async () => {
    const { fetchImpl } = recording(403)
    await expect(s3ImageStore(cfg, fetchImpl).put('events/x.jpg', JPEG, 'image/jpeg')).rejects.toThrow(/403/)
  })
})

describe('localImageStore', () => {
  const dirs: string[] = []
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  })

  it('writes files that the API serves at /images', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oedb-images-'))
    dirs.push(dir)
    const store = localImageStore(dir, 'http://localhost:3001/images')
    imageStore.setStore(store)
    await store.put('events/x.png', PNG, 'image/png')
    expect(await readFile(join(dir, 'events/x.png'))).toEqual(PNG)
    expect(store.url('events/x.png')).toBe('http://localhost:3001/images/events/x.png')

    const app = await buildApp({ logger: false })
    const ok = await app.inject({ method: 'GET', url: '/images/events/x.png' })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['content-type']).toBe('image/png')
    expect(ok.rawPayload).toEqual(PNG)
    expect((await app.inject({ method: 'GET', url: '/images/../secret' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/images/events/missing.png' })).statusCode).toBe(404)

    await store.delete('events/x.png')
    expect((await app.inject({ method: 'GET', url: '/images/events/x.png' })).statusCode).toBe(404)
    await app.close()
  })

  it('serves nothing when the store is not local', async () => {
    imageStore.setStore(null)
    const app = await buildApp({ logger: false })
    expect((await app.inject({ method: 'GET', url: '/images/events/x.png' })).statusCode).toBe(404)
    await app.close()
  })
})

describe('fetchRemoteImage', () => {
  const answering = (body: ConstructorParameters<typeof Response>[0], status = 200) =>
    (async () => new Response(body, { status })) as unknown as typeof fetch

  it('returns the image with its sniffed type', async () => {
    expect(await fetchRemoteImage('https://feed.test/a.png', answering(PNG))).toEqual({ data: PNG, type: 'image/png' })
  })

  it('returns null for an error answer, a non-image body or another protocol', async () => {
    expect(await fetchRemoteImage('https://feed.test/a.png', answering(PNG, 404))).toBeNull()
    expect(await fetchRemoteImage('https://feed.test/a.png', answering('<html>nope</html>'))).toBeNull()
    expect(await fetchRemoteImage('ftp://feed.test/a.png', answering(PNG))).toBeNull()
    expect(await fetchRemoteImage('not a url', answering(PNG))).toBeNull()
  })

  it('refuses local and private addresses', async () => {
    for (const url of ['http://localhost/a.png', 'http://127.0.0.1/a.png', 'http://10.1.2.3/a.png', 'http://192.168.0.1/a.png', 'http://169.254.169.254/a.png', 'http://[::1]/a.png']) {
      expect(await fetchRemoteImage(url, answering(PNG)), url).toBeNull()
    }
  })

  it('returns null when the network fails', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await fetchRemoteImage('https://feed.test/a.png', failing)).toBeNull()
  })

  it('returns null above the size limit', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(EVENT_IMAGE_MAX_BYTES + 1 - PNG.length)])
    expect(await fetchRemoteImage('https://feed.test/a.png', answering(big))).toBeNull()
    const fits = big.subarray(0, EVENT_IMAGE_MAX_BYTES)
    expect((await fetchRemoteImage('https://feed.test/a.png', answering(fits)))?.data.length).toBe(EVENT_IMAGE_MAX_BYTES)
  })
})
