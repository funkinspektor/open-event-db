'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { InlineLogin } from './InlineLogin'
import { StarIcon } from './Icons'
import { Toast } from './Toast'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const FAILED = 'Couldn’t update. Please try again.'

/**
 * Star button that marks an event as "mine". `interested === null` means logged out: the click opens the
 * inline login instead. Optimistic; a failure puts the star back and says so.
 */
export function InterestToggle({ eventId, interested }: { eventId: string; interested: boolean | null }) {
  const router = useRouter()
  const [on, setOn] = useState(interested)
  const [busy, setBusy] = useState(false)
  const [login, setLogin] = useState(false)
  const [toast, setToast] = useState<{ key: number; message: string; link?: boolean } | null>(null)

  // Follow the server when it re-renders with a different answer (e.g. after the post-login save).
  useEffect(() => setOn(interested), [interested])

  async function toggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    if (on === null) return setLogin(true)
    const next = !on
    setOn(next)
    setBusy(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/events/${eventId}/interest`, {
        method: next ? 'PUT' : 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        if (next) setToast({ key: Date.now(), message: 'Saved to My events', link: true })
        return
      }
      setOn(!next)
      if (res.status === 401) return setLogin(true)
      if (res.status === 403) return router.push('/welcome')
      setToast({ key: Date.now(), message: FAILED })
    } catch {
      setOn(!next)
      setToast({ key: Date.now(), message: FAILED })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="kk-star"
        aria-pressed={on === true}
        aria-label={on ? 'Remove from My events' : 'Interested'}
        onClick={toggle}
      >
        <StarIcon filled={on === true} />
      </button>
      {login && <InlineLogin returnTo={`/events/${eventId}?interest=1`} onClose={() => setLogin(false)} />}
      {toast && (
        <Toast
          key={toast.key}
          message={toast.message}
          action={toast.link ? { href: '/?mine=1', label: 'My events' } : undefined}
        />
      )}
    </>
  )
}
