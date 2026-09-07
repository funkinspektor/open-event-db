import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Header } from '@/components/Header'

export const metadata: Metadata = {
  title: {
    default: 'Open Event Database — Events in Berlin',
    template: '%s · Open Event Database',
  },
  description: 'Discover events in Berlin. A community-owned, open database of events.',
  openGraph: {
    type: 'website',
    siteName: 'Open Event Database',
  },
  twitter: { card: 'summary' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-neutral-50 text-neutral-900">
        <Header />
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 pt-6 text-xs text-neutral-500 sm:px-6">
          Open Event Database · community-owned, open source, EU-hosted.
        </footer>
      </body>
    </html>
  )
}
