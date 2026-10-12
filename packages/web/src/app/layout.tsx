import '@/styles/kellerkompass/tokens.css'
import '@/styles/kellerkompass/components.css'
import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Germania_One, JetBrains_Mono, Schibsted_Grotesk } from 'next/font/google'
import { Header } from '@/components/Header'
import { SITE_URL } from '@/lib/site'

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${germaniaOne.variable} ${schibstedGrotesk.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="kk-root flex min-h-full flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <footer className="kk-footer w-full">Kellerkompass · community-owned, open source, EU-hosted.</footer>
      </body>
    </html>
  )
}
