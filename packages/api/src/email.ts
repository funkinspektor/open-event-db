export type MagicLinkKind = 'login' | 'signup' | 'email_change'

export interface MagicLinkEmail {
  to: string
  url: string
  kind: MagicLinkKind
  /** email_change only: the handle of the account asking to use this address. */
  requesterHandle?: string
}

export interface EmailChangedNoticeEmail {
  /** The old address, which learns that the account moved. */
  to: string
  newEmail: string
}

export interface EmailTransport {
  sendMagicLink(msg: MagicLinkEmail): Promise<void>
  sendEmailChangedNotice(msg: EmailChangedNoticeEmail): Promise<void>
}

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const isProduction = process.env.NODE_ENV === 'production'

/** Where people reach us (the operator's address on the legal pages). Named in mails that say "contact us". */
export const contactEmail = () => process.env.CONTACT_EMAIL?.trim() || 'kontakt@kellerkompass.de'

/** The mail text for the old address when the email of an account changed. */
export function emailChangedNoticeText(brand: string, newEmail: string, contact = contactEmail()): string[] {
  return [
    `The email address of your ${brand} account was changed to ${newEmail}.`,
    '',
    `Logins now go to the new address. For safety, all other devices were logged out and the calendar link was reset.`,
    `If this wasn't you, please contact us right away: ${contact} (you can also reply to this mail).`,
  ]
}
const isTestRun = !!process.env.VITEST || process.env.NODE_ENV === 'test'

// Reserved TLDs (RFC 2606/6761) can never receive mail. Sending to them would only produce
// bounces that hurt the sender domain's reputation — the seed accounts use these.
const UNDELIVERABLE = /\.(example|test|invalid|local|localhost)$/i
export const isDeliverable = (address: string) => !UNDELIVERABLE.test(address.trim())

interface MagicLinkCopy {
  subject: (brand: string) => string
  intro: (brand: string, handle?: string) => string
  cta: (brand: string) => string
  validity: string
  ignore: (handle?: string) => string
}

const MAGIC_LINK_COPY: Record<MagicLinkKind, MagicLinkCopy> = {
  login: {
    subject: (b) => `Your ${b} login link`,
    intro: (b) => `Here is your login link for ${b}:`,
    cta: (b) => `Log in to ${b}`,
    validity: 'The link is valid for 15 minutes and can be used once.',
    ignore: () => "If you didn't request it, you can ignore this email.",
  },
  signup: {
    subject: (b) => `Confirm your email to join ${b}`,
    intro: (b) => `Confirm your email address to join ${b}:`,
    cta: (b) => `Confirm email and join ${b}`,
    validity: 'The link is valid for 15 minutes and can be used once.',
    ignore: () => "If you didn't request it, you can ignore this email. No account is created until you click the link.",
  },
  email_change: {
    subject: (b) => `Confirm your new ${b} email`,
    intro: (b, h) =>
      `Someone signed in as @${h ?? '?'} asked to use this address for their ${b} account. To confirm, open this link while logged in as @${h ?? '?'}:`,
    cta: () => 'Confirm new email',
    validity: 'The link is valid for 24 hours and can be used once.',
    ignore: (h) => `If this wasn't you, ignore this mail: nothing changes unless you confirm while logged in as @${h ?? '?'}.`,
  },
}

const consoleTransport: EmailTransport = {
  async sendMagicLink({ to, url, kind }) {
    const validity = kind === 'email_change' ? '24 hours' : '15 minutes'
    console.log(`\n[email → ${to}] ${MAGIC_LINK_COPY[kind].subject('Kellerkompass')} (valid ${validity}):\n  ${url}\n`)
  },
  async sendEmailChangedNotice({ to, newEmail }) {
    console.log(`\n[email → ${to}]\n${emailChangedNoticeText('Kellerkompass', newEmail).join('\n')}\n`)
  },
}

export interface ScalewayConfig {
  secretKey: string
  projectId: string
  region: string
  fromEmail: string
  fromName: string
}

/** Scaleway Transactional Email via its HTTP API. */
export function scalewayTransport(config: ScalewayConfig): EmailTransport {
  const endpoint = `https://api.scaleway.com/transactional-email/v1alpha1/regions/${config.region}/emails`

  async function post(to: string, subject: string, text: string, html: string, replyTo?: string): Promise<void> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-auth-token': config.secretKey },
      body: JSON.stringify({
        project_id: config.projectId,
        from: { email: config.fromEmail, name: config.fromName },
        to: [{ email: to }],
        subject,
        text,
        html,
        ...(replyTo ? { additional_headers: [{ key: 'Reply-To', value: replyTo }] } : {}),
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Scaleway TEM responded ${res.status}: ${detail.slice(0, 500)}`)
    }
    // Accepted only means queued — the id lets you look up delivery status in the Scaleway console.
    if (!isProduction) {
      const json = (await res.json().catch(() => null)) as { emails?: { id: string; status: string }[] } | null
      const sent = json?.emails?.[0]
      console.log(`[email → ${to}] accepted by Scaleway TEM (id ${sent?.id ?? '?'}, status ${sent?.status ?? '?'})`)
    }
  }

  return {
    async sendMagicLink(msg) {
      const { to, url, kind, requesterHandle } = msg
      // Outside production the link is always printed too, so seed accounts stay usable.
      if (!isProduction) await consoleTransport.sendMagicLink(msg)
      if (!isDeliverable(to)) return

      const brand = config.fromName
      const copy = MAGIC_LINK_COPY[kind]
      await post(
        to,
        copy.subject(brand),
        [copy.intro(brand, requesterHandle), '', url, '', copy.validity, copy.ignore(requesterHandle)].join('\n'),
        [
          `<p>${escapeHtml(copy.intro(brand, requesterHandle))}</p>`,
          `<p><a href="${escapeHtml(url)}">${copy.cta(brand)}</a></p>`,
          `<p>${copy.validity}<br>`,
          `${escapeHtml(copy.ignore(requesterHandle))}</p>`,
        ].join('\n'),
      )
    },

    async sendEmailChangedNotice(msg) {
      const { to, newEmail } = msg
      if (!isProduction) await consoleTransport.sendEmailChangedNotice(msg)
      if (!isDeliverable(to)) return

      const brand = config.fromName
      const contact = contactEmail()
      const text = emailChangedNoticeText(brand, newEmail, contact)
      await post(
        to,
        `Your ${brand} email was changed`,
        text.join('\n'),
        [
          `<p>The email address of your ${brand} account was changed to ${escapeHtml(newEmail)}.</p>`,
          `<p>${escapeHtml(text[2]!)}<br>`,
          `${escapeHtml(text[3]!)}</p>`,
        ].join('\n'),
        contact,
      )
    },
  }
}

function transportFromEnv(): EmailTransport {
  const provider = process.env.EMAIL_PROVIDER ?? 'console'
  // Automated tests never send real mail, whatever the local .env says.
  if (isTestRun || provider === 'console') return consoleTransport
  if (provider !== 'scaleway') throw new Error(`Unknown EMAIL_PROVIDER "${provider}" (use console or scaleway)`)

  const env = {
    SCALEWAY_SECRET_KEY: process.env.SCALEWAY_SECRET_KEY,
    SCALEWAY_PROJECT_ID: process.env.SCALEWAY_PROJECT_ID,
    EMAIL_FROM: process.env.EMAIL_FROM,
  }
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) throw new Error(`EMAIL_PROVIDER=scaleway needs ${missing.join(', ')}`)

  return scalewayTransport({
    secretKey: env.SCALEWAY_SECRET_KEY!,
    projectId: env.SCALEWAY_PROJECT_ID!,
    region: process.env.SCALEWAY_REGION ?? 'fr-par',
    fromEmail: env.EMAIL_FROM!,
    fromName: process.env.EMAIL_FROM_NAME ?? 'Kellerkompass',
  })
}

const defaultTransport = transportFromEnv()
let transport: EmailTransport = defaultTransport

export const email = {
  get transport(): EmailTransport {
    return transport
  },
  setTransport(t: EmailTransport) {
    transport = t
  },
  reset() {
    transport = defaultTransport
  },
}
