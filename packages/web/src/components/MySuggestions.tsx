'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MySuggestion } from '@open-event-db/shared'
import { formatDate } from '@/lib/format'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const THANKS = 'Thanks! The Kellerkompass team will review it. We’ll email you when it’s live.'

const IMAGE_NOTICES: Record<string, string> = {
  image_failed: 'Your suggestion was sent, but the image couldn’t be uploaded.',
  image_unavailable: 'Your suggestion was sent, but images can’t be uploaded right now.',
}

const LOAD_FAILED = 'Your suggestions couldn’t be loaded. Try again later.'

/**
 * "My suggestions": what the account suggested and where each one stands; `suggestions` is null when loading them
 * failed. `justSent` is the `?suggested=` value after sending: the thanks show once, then the URL drops it.
 */
export function MySuggestions({ suggestions, justSent }: { suggestions: MySuggestion[] | null; justSent?: string }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [thanks, setThanks] = useState(justSent)

  // Kept in state, so the thanks stay while the URL loses the parameter: a reload or a withdraw doesn't repeat them
  useEffect(() => {
    if (justSent) router.replace('/dashboard', { scroll: false })
  }, [justSent, router])

  async function withdraw(s: MySuggestion) {
    if (!window.confirm(`Withdraw “${s.title}”? The team won’t see it any more.`)) return
    setError(null)
    setThanks(undefined)
    setBusyId(s.id)
    try {
      const res = await fetch(`${API_URL}/api/v1/suggestions/${s.id}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(json.error?.message ?? `Request failed (${res.status})`)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="my-suggestions">
      {thanks && (
        <div className="kk-notice mb-6" role="status">
          {THANKS}
          {IMAGE_NOTICES[thanks] && <> {IMAGE_NOTICES[thanks]}</>}
        </div>
      )}
      <h2 id="my-suggestions" className="kk-section-title">
        My suggestions
      </h2>
      <hr className="kk-rule" />
      {error && (
        <div className="kk-alert mt-4" role="alert">
          {error}
        </div>
      )}
      {suggestions === null ? (
        <div className="kk-alert mt-4" role="alert">
          {LOAD_FAILED}
        </div>
      ) : suggestions.length === 0 ? (
        <p className="kk-empty">
          No suggestions yet.{' '}
          <Link href="/events/new" className="underline underline-offset-2">
            Suggest event
          </Link>
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {suggestions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line py-4">
              <div className="min-w-0">
                <div className="text-[18px] font-bold">{s.title}</div>
                <div className="text-body text-muted">{formatDate(s.starts_at)}</div>
                {s.status === 'not_accepted' && s.reason && <div className="text-body text-muted">{s.reason}</div>}
              </div>
              <div className="flex items-center gap-3">
                {s.status === 'in_review' && (
                  <>
                    <span className="kk-badge kk-badge--scout">In review</span>
                    <button
                      type="button"
                      className="kk-btn kk-btn--outline"
                      disabled={busyId === s.id}
                      onClick={() => withdraw(s)}
                    >
                      Withdraw
                    </button>
                  </>
                )}
                {s.status === 'live' && (
                  <>
                    <span className="kk-badge kk-badge--fit">Live</span>
                    {s.event_id && (
                      <Link href={`/events/${s.event_id}`} className="kk-btn kk-btn--outline">
                        View event
                      </Link>
                    )}
                  </>
                )}
                {s.status === 'not_accepted' && <span className="kk-badge kk-badge--cancelled">Not accepted</span>}
                {s.status === 'expired' && <span className="kk-badge kk-badge--postponed">Not reviewed in time</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
