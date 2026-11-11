'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { AccountMe } from '@open-event-db/shared'
import { LoginForm } from './LoginForm'
import { LogoutButton } from './LogoutButton'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type Outcome = 'changed' | 'taken' | 'wrong_account' | 'invalid_token'

async function fetchMe(): Promise<AccountMe | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/me`, { credentials: 'include', cache: 'no-store' })
    if (!res.ok) return null
    return ((await res.json()) as { data: AccountMe }).data
  } catch {
    return null
  }
}

/**
 * Landing page of the email-change link. Never confirms on load (mail scanners and prefetchers open links);
 * the button does. The token is read once and removed from the visible URL.
 */
export function ConfirmEmailChange() {
  const read = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [me, setMe] = useState<AccountMe | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Guarded so React Strict Mode's second effect run doesn't lose the token after it is stripped from the URL.
    if (read.current) return
    read.current = true
    const t = new URLSearchParams(window.location.search).get('token')
    if (t) {
      setToken(t)
      window.history.replaceState(null, '', window.location.pathname)
    }
    fetchMe().then((account) => {
      setMe(account)
      setLoaded(true)
    })
  }, [])

  async function confirm() {
    if (!token) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/accounts/me/email/confirm`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: { result: 'changed' | 'taken' }
        error?: { code?: string; message?: string }
      }
      if (res.ok && json.data) {
        if (json.data.result === 'changed') setMe(await fetchMe())
        return setOutcome(json.data.result)
      }
      if (res.status === 401) return setMe(null)
      const code = json.error?.code
      if (code === 'wrong_account' || code === 'invalid_token') return setOutcome(code)
      setError(json.error?.message ?? `Request failed (${res.status})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return null

  if (outcome === 'changed') {
    return (
      <div className="kk-panel" style={{ gap: 10 }}>
        <p className="m-0 text-body">
          {me ? (
            <>
              Your email is now <span className="font-medium text-ink">{me.email}</span>. Use it to log in from now
              on.
            </>
          ) : (
            'Your email was changed. Use the new address to log in from now on.'
          )}
        </p>
        <div>
          <Link href="/profile" className="kk-btn kk-btn--secondary">
            Back to profile
          </Link>
        </div>
      </div>
    )
  }
  if (outcome === 'taken') {
    return (
      <div className="kk-panel" style={{ gap: 10 }}>
        <p className="m-0 text-body">This address is already in use.</p>
        <div>
          <Link href="/profile" className="kk-btn kk-btn--secondary">
            Back to profile
          </Link>
        </div>
      </div>
    )
  }
  if (outcome === 'wrong_account') {
    return (
      <div className="kk-panel" style={{ gap: 10 }}>
        <p className="m-0 text-body">
          You’re logged in as @{me?.handle}, but this change was requested by another account. Log out and log in as
          that account.
        </p>
        <div>
          <LogoutButton className="kk-btn kk-btn--secondary" />
        </div>
      </div>
    )
  }
  if (outcome === 'invalid_token' || !token) {
    return (
      <div className="kk-panel" style={{ gap: 10 }}>
        <p className="m-0 text-body">This link has expired or was already used.</p>
      </div>
    )
  }

  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <p className="m-0 text-body text-muted">Log in as the account that asked for this change.</p>
        <LoginForm returnTo={`/confirm-email?token=${encodeURIComponent(token)}`} />
      </div>
    )
  }

  return (
    <div className="kk-panel" style={{ gap: 12 }}>
      <p className="m-0 text-body">Confirm the change of your login email address.</p>
      {error && (
        <div className="kk-alert" role="alert">
          {error}
        </div>
      )}
      <div>
        <button type="button" disabled={busy} onClick={confirm} className="kk-btn kk-btn--primary kk-btn--lg">
          {busy ? 'Confirming…' : 'Confirm new email'}
        </button>
      </div>
    </div>
  )
}
