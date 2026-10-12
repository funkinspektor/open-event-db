export interface MagicLinkEmail {
  to: string
  url: string
}

export interface EmailTransport {
  sendMagicLink(msg: MagicLinkEmail): Promise<void>
}

const isProduction = process.env.NODE_ENV === 'production'
const isTestRun = !!process.env.VITEST || process.env.NODE_ENV === 'test'

// Reserved TLDs (RFC 2606/6761) can never receive mail. Sending to them would only produce
// bounces that hurt the sender domain's reputation — the seed publishers use these.
const UNDELIVERABLE = /\.(example|test|invalid|local|localhost)$/i
export const isDeliverable = (address: string) => !UNDELIVERABLE.test(address.trim())

const consoleTransport: EmailTransport = {
  async sendMagicLink({ to, url }) {
    console.log(`\n[email → ${to}] Your login link (valid 15 minutes):\n  ${url}\n`)
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

  return {
    async sendMagicLink({ to, url }) {
      // Outside production the link is always printed too, so seed accounts stay usable.
      if (!isProduction) await consoleTransport.sendMagicLink({ to, url })
      if (!isDeliverable(to)) return

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-auth-token': config.secretKey },
        body: JSON.stringify({
          project_id: config.projectId,
          from: { email: config.fromEmail, name: config.fromName },
          to: [{ email: to }],
          subject: `Your ${config.fromName} login link`,
          text: [
            `Here is your login link for ${config.fromName}:`,
            '',
            url,
            '',
            'The link is valid for 15 minutes and can be used once.',
            "If you didn't request it, you can ignore this email.",
          ].join('\n'),
          html: [
            `<p>Here is your login link for ${config.fromName}:</p>`,
            `<p><a href="${url}">Log in to ${config.fromName}</a></p>`,
            '<p>The link is valid for 15 minutes and can be used once.<br>',
            "If you didn't request it, you can ignore this email.</p>",
          ].join('\n'),
        }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`Scaleway TEM responded ${res.status}: ${detail.slice(0, 500)}`)
      }
    },
  }
}

function transportFromEnv(): EmailTransport {
  const provider = process.env.EMAIL_PROVIDER ?? 'console'
  // Automated tests never send real mail, whatever the local .env says.
  if (isTestRun || provider === 'console') return consoleTransport
  if (provider !== 'scaleway') throw new Error(`Unknown EMAIL_PROVIDER "${provider}" (use console or scaleway)`)

  const env = {
    SCW_SECRET_KEY: process.env.SCW_SECRET_KEY,
    SCW_DEFAULT_PROJECT_ID: process.env.SCW_DEFAULT_PROJECT_ID,
    EMAIL_FROM: process.env.EMAIL_FROM,
  }
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) throw new Error(`EMAIL_PROVIDER=scaleway needs ${missing.join(', ')}`)

  return scalewayTransport({
    secretKey: env.SCW_SECRET_KEY!,
    projectId: env.SCW_DEFAULT_PROJECT_ID!,
    region: process.env.SCW_DEFAULT_REGION ?? 'fr-par',
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
