import type { Metadata } from 'next'
import Link from 'next/link'
import { Headline } from '@/components/Headline'

export const metadata: Metadata = { title: 'Account deleted' }

export default function GoodbyePage() {
  return (
    <div className="kk-container w-full" style={{ maxWidth: 480, paddingTop: 80, gap: 28 }}>
      <section className="kk-intro" style={{ gap: 14 }}>
        <Headline text="Goodbye" narrow />
        <p className="kk-lede">Your account is deleted. Thanks for being here.</p>
      </section>
      <div>
        <Link href="/" className="kk-btn kk-btn--secondary kk-btn--lg">
          Back to events
        </Link>
      </div>
    </div>
  )
}
