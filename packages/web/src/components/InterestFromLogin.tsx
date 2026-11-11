'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Toast } from './Toast'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const FAILED = 'Couldn’t save the event. Tap the star to try again.'

/**
 * Mounted on every event page for logged-in accounts, so its toast survives the refresh. When the page was
 * opened from the login link of the inline login (`pending`, i.e. `?interest=1`), it saves the interest the
 * visitor asked for before logging in, says so, drops the parameter and refreshes the star.
 */
export function InterestFromLogin({ eventId, pending }: { eventId: string; pending: boolean }) {
  const router = useRouter()
  const started = useRef(false)
  const [result, setResult] = useState<'saved' | 'failed' | null>(null)

  useEffect(() => {
    if (!pending || started.current) return
    started.current = true
    const strip = () => {
      const url = new URL(window.location.href)
      url.searchParams.delete('interest')
      window.history.replaceState(window.history.state, '', url)
    }
    fetch(`${API_URL}/api/v1/events/${eventId}/interest`, { method: 'PUT', credentials: 'include' })
      .then((res) => {
        if (res.status === 403) return router.replace('/welcome')
        setResult(res.ok ? 'saved' : 'failed')
        strip()
        router.refresh()
      })
      .catch(() => {
        setResult('failed')
        strip()
      })
  }, [pending, eventId, router])

  if (result === 'saved') return <Toast message="Saved to My events" action={{ href: '/?mine=1', label: 'My events' }} />
  if (result === 'failed') return <Toast message={FAILED} />
  return null
}
