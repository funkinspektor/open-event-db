'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MySuggestion } from '@open-event-db/shared'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/** The note on top of a suggestion's preview page: where it stands, and for one in review, Withdraw. */
export function SuggestionNotice({ suggestion }: { suggestion: Pick<MySuggestion, 'id' | 'title' | 'status' | 'reason'> }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function withdraw() {
    if (!window.confirm(`Withdraw “${suggestion.title}”? The team won’t see it any more.`)) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/suggestions/${suggestion.id}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(json.error?.message ?? `Request failed (${res.status})`)
        setBusy(false)
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
      setBusy(false)
    }
  }

  return (
    <>
      <div className="kk-notice flex flex-wrap items-center justify-between gap-x-6 gap-y-3" role="status">
        <p className="m-0">
          {suggestion.status === 'in_review' && (
            <>
              <strong>In review.</strong> The Kellerkompass team checks it before it goes live. Only you can see this page.
            </>
          )}
          {suggestion.status === 'not_accepted' && (
            <>
              <strong>Not accepted.</strong>
              {suggestion.reason && ` Reason: ${suggestion.reason}`}
            </>
          )}
          {suggestion.status === 'expired' && (
            <>
              <strong>Not reviewed in time.</strong> The event is over.
            </>
          )}
        </p>
        {suggestion.status === 'in_review' && (
          <button type="button" className="kk-btn kk-btn--outline" disabled={busy} onClick={withdraw}>
            Withdraw
          </button>
        )}
      </div>
      {error && (
        <div className="kk-alert" role="alert">
          {error}
        </div>
      )}
    </>
  )
}
