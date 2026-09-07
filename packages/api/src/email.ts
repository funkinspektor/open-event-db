export interface MagicLinkEmail {
  to: string
  url: string
}

export interface EmailTransport {
  sendMagicLink(msg: MagicLinkEmail): Promise<void>
}

const consoleTransport: EmailTransport = {
  async sendMagicLink({ to, url }) {
    console.log(`\n[email → ${to}] Your login link (valid 15 minutes):\n  ${url}\n`)
  },
}

let transport: EmailTransport = consoleTransport

export const email = {
  get transport(): EmailTransport {
    return transport
  },
  setTransport(t: EmailTransport) {
    transport = t
  },
  reset() {
    transport = consoleTransport
  },
}
