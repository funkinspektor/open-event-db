'use client'

import { useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const isDev = process.env.NODE_ENV !== 'production'

/** Email shown on the profile; changing it sends a confirmation link to the new address. */
export function EmailChangeForm({ email, result }: { email: string; result?: 'changed' | 'taken' }) {
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/accounts/me/email`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: next }),
      })
      if (res.ok) return setSentTo(next)
      const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
      if (res.status === 429) setError('Too many requests. Please try again later.')
      else if (json.error?.code === 'same_email') setError('That is already your email address.')
      else setError(json.error?.message ?? `Request failed (${res.status})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="kk-panel">
      <div className="kk-field">
        Email
        <input value={email} disabled className="kk-input" aria-label="Current email" />
        <span className="kk-hint">Used for login links.</span>
      </div>

      {result === 'changed' && (
        <p className="kk-hint kk-hint--ok m-0 text-[14px] font-bold">Your email address was changed.</p>
      )}
      {result === 'taken' && (
        <div className="kk-alert" role="alert">
          This address is already in use.
        </div>
      )}

      {sentTo ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-body">
            We sent a confirmation link to <span className="font-medium text-ink">{sentTo}</span>. Your email
            changes once you open it.
          </p>
          {isDev && <p className="kk-hint m-0">Dev mode: no email is sent — the link is printed in the API server log.</p>}
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="kk-field">
            New email
            <input
              type="email"
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="kk-input"
              placeholder="you@example.com"
              autoComplete="off"
            />
          </label>
          {error && (
            <div className="kk-alert" role="alert">
              {error}
            </div>
          )}
          <div>
            <button type="submit" disabled={busy || !next} className="kk-btn kk-btn--secondary">
              {busy ? 'Sending…' : 'Send confirmation link'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
