import type { Metadata } from 'next'
import { ConfirmEmailChange } from '@/components/ConfirmEmailChange'
import { Headline } from '@/components/Headline'

// The link carries a one-time token in the query string; keep it out of Referer headers.
export const metadata: Metadata = { title: 'Confirm your new email', referrer: 'no-referrer', robots: { index: false } }

export default function ConfirmEmailPage() {
  return (
    <div className="kk-container w-full" style={{ maxWidth: 480, paddingTop: 80, gap: 28 }}>
      <section className="kk-intro" style={{ gap: 14 }}>
        <Headline text="Confirm your new email" narrow />
      </section>
      <ConfirmEmailChange />
    </div>
  )
}
