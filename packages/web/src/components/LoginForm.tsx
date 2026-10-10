'use client'

import { useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const isDev = process.env.NODE_ENV !== 'production'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'limited' | 'error'>('idle')

  if (state === 'sent') {
    return (
      <div className="kk-panel" style={{ gap: 10 }}>
        <h2 className="kk-section-title" style={{ margin: 0, fontSize: 34 }}>
          <span className="kk-live-dot" aria-hidden />
          Check your email
        </h2>
        <p className="m-0 text-muted">
          If <span className="font-medium text-ink">{email}</span> is registered, a login link is on its way. It’s
          valid for 15 minutes.
        </p>
        {isDev && <p className="kk-hint m-0">Dev mode: no email is sent — the link is printed in the API server log.</p>}
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={async (e) => {
        e.preventDefault()
        setState('busy')
        try {
          const res = await fetch(`${API_URL}/api/v1/auth/magic-link`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email }),
          })
          if (res.status === 429) return setState('limited')
          if (!res.ok) return setState('error')
          setState('sent')
        } catch {
          setState('error')
        }
      }}
    >
      <label className="kk-field">
        Email
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="kk-input"
          style={{ height: 52, fontSize: 17 }}
          placeholder="you@example.com"
        />
      </label>
      {state === 'limited' && <p className="kk-error">Too many login requests. Please try again later.</p>}
      {state === 'error' && <p className="kk-error">Something went wrong. Please try again.</p>}
      <button type="submit" disabled={state === 'busy'} className="kk-btn kk-btn--primary kk-btn--lg">
        {state === 'busy' ? 'Sending…' : 'Send me a login link'}
      </button>
      <p className="kk-hint m-0 text-[14px]">No password needed. We’ll email you a one-time link.</p>
    </form>
  )
}
