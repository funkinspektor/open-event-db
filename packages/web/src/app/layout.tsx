import '@/styles/kellerkompass/tokens.css'
import '@/styles/kellerkompass/components.css'
import './globals.css'
import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Germania_One, JetBrains_Mono, Schibsted_Grotesk } from 'next/font/google'
import { Suspense } from 'react'
import { Header } from '@/components/Header'
import { OnboardingGate } from '@/components/OnboardingGate'
import { SITE_URL } from '@/lib/site'
import { getCurrentAccount } from '@/lib/session'
import { needsWelcome } from '@/lib/onboarding'

// Self-hosted at build time by next/font — visitors never request fonts from Google.
const germaniaOne = Germania_One({ weight: '400', subsets: ['latin'], variable: '--font-germania-one' })
const schibstedGrotesk = Schibsted_Grotesk({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-schibsted-grotesk',
})
const jetbrainsMono = JetBrains_Mono({ weight: '500', subsets: ['latin'], variable: '--font-jetbrains-mono' })

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Kellerkompass — Events in Berlin',
    template: '%s · Kellerkompass',
  },
  description: 'Discover events in Berlin. A community-owned, open database of events.',
  applicationName: 'Kellerkompass',
  openGraph: {
    type: 'website',
    siteName: 'Kellerkompass',
  },
  twitter: { card: 'summary' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0c0c0d',
  colorScheme: 'dark',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Onboarding gate: an account that hasn't finished /welcome can't use the rest of the site.
  // getCurrentAccount is cached per request, so the header's lookup reuses this one.
  const path = (await headers()).get('x-pathname') ?? '/'
  const me = await getCurrentAccount()
  if (needsWelcome(path, me)) redirect('/welcome?return_to=' + encodeURIComponent(path))

  return (
    <html
      lang="en"
      className={`${germaniaOne.variable} ${schibstedGrotesk.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="kk-root flex min-h-full flex-col">
        {me && !me.onboarded && (
          <Suspense>
            <OnboardingGate me={me} />
          </Suspense>
        )}
        <Header />
        <main className="flex-1">{children}</main>
        <footer className="kk-footer w-full">
          <span>Kellerkompass · community-owned, open source, EU-hosted.</span>
          {/* German pages, linked under their German names as German law expects */}
          <nav className="kk-footer__links" aria-label="Rechtliches" lang="de">
            <Link href="/impressum">Impressum</Link>
            <Link href="/datenschutz">Datenschutz</Link>
            <Link href="/nutzungsbedingungen">Nutzungsbedingungen</Link>
            <Link href="/lizenz">Datenlizenz &amp; API</Link>
          </nav>
        </footer>
      </body>
    </html>
  )
}
