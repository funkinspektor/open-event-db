'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { handleFromName, handleSchema, safeReturnTo } from '@open-event-db/shared'
import { TickIcon } from './Icons'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type HandleState = 'invalid' | 'checking' | 'available' | 'taken' | 'unknown'

const HANDLE_HINT: Record<HandleState, { text: string; className: string }> = {
  invalid: {
    text: 'Lowercase letters, numbers and dashes only; no dash at the start or end.',
    className: 'kk-hint !text-ink',
  },
  checking: { text: 'Checking…', className: 'kk-hint' },
  available: { text: 'Available', className: 'kk-hint kk-hint--ok' },
  taken: { text: 'This handle isn’t available.', className: 'kk-hint !text-ink' },
  unknown: { text: 'Could not check availability — it will be checked on save.', className: 'kk-hint' },
}

const ERROR_COPY: Record<string, string> = {
  handle_taken: 'This handle isn’t available.',
  handle_reserved: 'This handle isn’t available.',
  terms_required: 'Please accept the Terms of Use to continue.',
}

/** Finishes sign-up: display name, handle and acceptance of the terms. */
export function WelcomeForm({ initialName, returnTo }: { initialName: string; returnTo?: string }) {
  const router = useRouter()
  const [displayName, setDisplayName] = useState(initialName)
  const [handle, setHandle] = useState(() => handleFromName(initialName))
  // The handle follows the name until the person edits it themselves.
  const [handleEdited, setHandleEdited] = useState(false)
  const [handleState, setHandleState] = useState<HandleState>('checking')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!handleSchema.safeParse(handle).success) return setHandleState('invalid')

    setHandleState('checking')
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/accounts/check-handle?handle=${encodeURIComponent(handle)}`, {
          signal: ctrl.signal,
        })
        if (!res.ok) return setHandleState('unknown')
        const json = (await res.json()) as { data: { available: boolean } }
        setHandleState(json.data.available ? 'available' : 'taken')
      } catch {
        if (!ctrl.signal.aborted) setHandleState('unknown')
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [handle])

  function done() {
    router.replace(safeReturnTo(returnTo) ?? '/')
    router.refresh()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/accounts/me/onboarding`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: displayName, handle, accept_terms: true }),
      })
      if (res.ok) return done()
      const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
      const code = json.error?.code
      if (code === 'already_onboarded') return done()
      setError((code && ERROR_COPY[code]) ?? json.error?.message ?? `Request failed (${res.status})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  const blocked = handleState === 'invalid' || handleState === 'taken' || handleState === 'checking'

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="kk-panel">
        <label className="kk-field">
          Your name
          <input
            required
            autoFocus
            maxLength={60}
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value)
              if (!handleEdited) setHandle(handleFromName(e.target.value))
            }}
            className="kk-input"
          />
        </label>

        <label className="kk-field">
          Handle
          <input
            required
            value={handle}
            onChange={(e) => {
              setHandleEdited(true)
              setHandle(e.target.value.toLowerCase())
            }}
            className="kk-input"
            autoComplete="off"
            spellCheck={false}
          />
          <span className={HANDLE_HINT[handleState].className}>
            {handleState === 'available' && (
              <>
                <TickIcon size={12} />{' '}
              </>
            )}
            {HANDLE_HINT[handleState].text}
          </span>
        </label>

        <div className="flex items-start gap-2.5 text-body">
          <input
            id="accept-terms"
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-1"
          />
          <label htmlFor="accept-terms">
            I accept the{' '}
            <Link href="/nutzungsbedingungen" target="_blank" className="underline">
              Terms of Use
            </Link>{' '}
            and have read the{' '}
            <Link href="/datenschutz" target="_blank" className="underline">
              Privacy Policy
            </Link>
            .
          </label>
        </div>
      </div>

      {error && (
        <div className="kk-alert" role="alert">
          {error}
        </div>
      )}

      <button type="submit" disabled={busy || blocked || !accepted} className="kk-btn kk-btn--primary kk-btn--lg">
        {busy ? 'Saving…' : 'Continue'}
      </button>
    </form>
  )
}
