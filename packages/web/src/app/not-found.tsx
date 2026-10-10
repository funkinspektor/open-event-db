import Link from 'next/link'
import { Headline } from '@/components/Headline'
import { BackIcon } from '@/components/Icons'

export default function NotFound() {
  return (
    <div className="kk-container kk-container--narrow">
      <section className="kk-intro" style={{ gap: 14 }}>
        <p className="kk-eyebrow">404</p>
        <Headline text="Not found" narrow />
        <p className="kk-lede">We couldn’t find what you were looking for.</p>
      </section>
      <Link href="/" className="kk-eyebrow">
        <BackIcon />
        Events
      </Link>
    </div>
  )
}
