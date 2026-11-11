'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Toast } from './Toast'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const FAILED = 'Couldn’t save the event. Tap the star to try again.'

/**
 * Lands here from the login link of the inline login (`/events/<id>?interest=1`): saves the interest the
 * visitor asked for before logging in, says so, and drops the parameter.
 */
export function InterestFromLogin({ eventId }: { eventId: string }) {
  const router = useRouter()
  const started = useRef(false)
  const [result, setResult] = useState<'saved' | 'failed' | null>(null)

  useEffect(() => {
    if (started.current) return
    started.current = true
    fetch(`${API_URL}/api/v1/events/${eventId}/interest`, { method: 'PUT', credentials: 'include' })
      .then((res) => {
        if (res.status === 403) return router.replace('/welcome')
        setResult(res.ok ? 'saved' : 'failed')
        router.replace(`/events/${eventId}`, { scroll: false })
        router.refresh()
      })
      .catch(() => setResult('failed'))
  }, [eventId, router])

  if (result === 'saved') return <Toast message="Saved to My events" action={{ href: '/?mine=1', label: 'My events' }} />
  if (result === 'failed') return <Toast message={FAILED} />
  return null
}
