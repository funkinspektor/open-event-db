'use client'

import { startTransition, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Headline } from '@/components/Headline'
import { BackIcon } from '@/components/Icons'

// Shown when a page fails to render, usually because the API was briefly unreachable (a restart or deploy).
// "Try again" re-renders the page on the server; reset() alone would only retry the client side.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()

  useEffect(() => {
    console.error(error)
  }, [error])

  const retry = () =>
    startTransition(() => {
      router.refresh()
      reset()
    })

  return (
    <div className="kk-container kk-container--narrow">
      <section className="kk-intro" style={{ gap: 14 }}>
        <p className="kk-eyebrow">Error</p>
        <Headline text="Didn’t load" narrow />
        <p className="kk-lede">This page didn’t load. That usually sorts itself out within a few seconds.</p>
        <div>
          <button type="button" className="kk-btn kk-btn--primary" onClick={retry}>
            Try again
          </button>
        </div>
      </section>
      <Link href="/" className="kk-eyebrow">
        <BackIcon />
        Events
      </Link>
    </div>
  )
}
