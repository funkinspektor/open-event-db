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
    await email.transport.sendMagicLink({ to: 'someone@real-domain.de', url: 'http://x/verify?token=t', kind: 'login' })
    expect(log).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('scaleway transport', () => {
  it('posts the magic link to the Scaleway TEM API', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await scalewayTransport(config).sendMagicLink({ to: 'kommunikation@letzte-welle.de', url: 'http://x/verify?token=abc', kind: 'login' })

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

  it('never mails reserved domains like the seed accounts', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await scalewayTransport(config).sendMagicLink({ to: 'crew@nachtagentur.example', url: 'http://x', kind: 'login' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws with the API error when Scaleway rejects the mail', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('domain not verified', { status: 400 })))
    await expect(
      scalewayTransport(config).sendMagicLink({ to: 'a@letzte-welle.de', url: 'http://x', kind: 'login' }),
    ).rejects.toThrow(/400: domain not verified/)
  })
})

describe('scaleway transport subjects', () => {
  const sent = async (run: (t: ReturnType<typeof scalewayTransport>) => Promise<void>) => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await run(scalewayTransport(config))
    return JSON.parse(fetchMock.mock.calls[0]![1].body)
  }

  it.each([
    ['login', 'Your Kellerkompass login link', '15 minutes'],
    ['signup', 'Confirm your email to join Kellerkompass', '15 minutes'],
    ['email_change', 'Confirm your new Kellerkompass email', '24 hours'],
  ] as const)('%s mail', async (kind, subject, validity) => {
    const body = await sent((t) => t.sendMagicLink({ to: 'a@letzte-welle.de', url: 'http://x/v?token=1', kind }))
    expect(body.subject).toBe(subject)
    expect(body.text).toContain('http://x/v?token=1')
    expect(body.text).toContain(validity)
  })

  it('email-changed notice goes to the old address and names the new one', async () => {
    const body = await sent((t) => t.sendEmailChangedNotice({ to: 'old@letzte-welle.de', newEmail: 'new@letzte-welle.de' }))
    expect(body.subject).toBe('Your Kellerkompass email was changed')
    expect(body.to).toEqual([{ email: 'old@letzte-welle.de' }])
    expect(body.text).toContain('new@letzte-welle.de')
  })

  it('email-changed notice says how to reach us, sets Reply-To and mentions the logout and calendar reset', async () => {
    const body = await sent((t) => t.sendEmailChangedNotice({ to: 'old@letzte-welle.de', newEmail: 'new@letzte-welle.de' }))
    expect(body.text).toContain('kontakt@kellerkompass.de')
    expect(body.html).toContain('kontakt@kellerkompass.de')
    expect(body.text).toMatch(/other devices were logged out/)
    expect(body.text).toMatch(/calendar link was reset/)
    expect(body.additional_headers).toEqual([{ key: 'Reply-To', value: 'kontakt@kellerkompass.de' }])
  })

  it('live mail names the event, its date and its link', async () => {
    const body = await sent((t) =>
      t.sendEventLive({
        to: 'fan@letzte-welle.de',
        title: 'Keller <Nacht>',
        startsAt: '2031-07-04T19:30:00.000Z',
        url: 'http://web.test/events/abc',
      }),
    )
    expect(body.subject).toBe('Your event is live on Kellerkompass')
    expect(body.to).toEqual([{ email: 'fan@letzte-welle.de' }])
    expect(body.text).toContain('Keller <Nacht>')
    expect(body.text).toMatch(/Friday,? 4 July 2031/)
    expect(body.text).toContain('21:30') // Berlin time
    expect(body.text).toContain('http://web.test/events/abc')
    expect(body.text).not.toMatch(/scout/i)
    expect(body.html).toContain('Keller &lt;Nacht&gt;')
    expect(body.html).toContain('href="http://web.test/events/abc"')
  })

  it('live mail without a start time names the day only', async () => {
    const body = await sent((t) =>
      t.sendEventLive({
        to: 'fan@letzte-welle.de',
        title: 'Flohmarkt',
        startsAt: '2031-07-03T22:00:00.000Z',
        startTimeKnown: false,
        url: 'http://web.test/events/def',
      }),
    )
    expect(body.text).toMatch(/Friday,? 4 July 2031/)
    expect(body.text).not.toContain('00:00')
  })

  it('the contact address comes from CONTACT_EMAIL', async () => {
    vi.stubEnv('CONTACT_EMAIL', 'help@example.org')
    const body = await sent((t) => t.sendEmailChangedNotice({ to: 'old@letzte-welle.de', newEmail: 'new@letzte-welle.de' }))
    vi.unstubAllEnvs()
    expect(body.text).toContain('help@example.org')
    expect(body.additional_headers).toEqual([{ key: 'Reply-To', value: 'help@example.org' }])
  })
})

describe('console transport', () => {
  it('logs the live mail', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await email.transport.sendEventLive({
      to: 'fan@letzte-welle.de',
      title: 'Keller Nacht',
      startsAt: '2031-07-04T19:30:00.000Z',
      url: 'http://web.test/events/abc',
    })
    expect(log).toHaveBeenCalledOnce()
    expect(String(log.mock.calls[0]![0])).toContain('http://web.test/events/abc')
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
