import { afterEach, describe, expect, it, vi } from 'vitest'
import { email, isDeliverable, scalewayTransport } from './email.js'

const config = {
  secretKey: 'scw-secret',
  projectId: 'project-123',
  region: 'fr-par',
  fromEmail: 'noreply@kellerkompass.test',
  fromName: 'Kellerkompass',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('email transport selection', () => {
  it('uses the console transport under Vitest', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await email.transport.sendMagicLink({ to: 'someone@real-domain.de', url: 'http://x/verify?token=t' })
    expect(log).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('scaleway transport', () => {
  it('posts the magic link to the Scaleway TEM API', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await scalewayTransport(config).sendMagicLink({ to: 'kommunikation@letzte-welle.de', url: 'http://x/verify?token=abc' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails')
    expect(init.headers['x-auth-token']).toBe('scw-secret')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      project_id: 'project-123',
      from: { email: 'noreply@kellerkompass.test', name: 'Kellerkompass' },
      to: [{ email: 'kommunikation@letzte-welle.de' }],
    })
    expect(body.text).toContain('http://x/verify?token=abc')
    expect(body.html).toContain('href="http://x/verify?token=abc"')
  })

  it('never mails reserved domains like the seed publishers', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await scalewayTransport(config).sendMagicLink({ to: 'crew@nachtagentur.example', url: 'http://x' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws with the API error when Scaleway rejects the mail', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('domain not verified', { status: 400 })))
    await expect(
      scalewayTransport(config).sendMagicLink({ to: 'a@letzte-welle.de', url: 'http://x' }),
    ).rejects.toThrow(/400: domain not verified/)
  })
})

describe('isDeliverable', () => {
  it.each([
    ['a@letzte-welle.de', true],
    ['crew@nachtagentur.example', false],
    ['login@test.local', false],
    ['x@foo.test', false],
    ['x@foo.invalid', false],
  ])('%s → %s', (address, expected) => {
    expect(isDeliverable(address)).toBe(expected)
  })
})
