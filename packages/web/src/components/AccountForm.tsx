'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { handleSchema, type AccountMe } from '@open-event-db/shared'
import { TickIcon } from './Icons'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type HandleState = 'current' | 'invalid' | 'checking' | 'available' | 'taken' | 'unknown'

const HANDLE_HINT: Record<HandleState, { text: string; className: string }> = {
  current: { text: 'Your current handle.', className: 'kk-hint' },
  invalid: {
    text: 'Lowercase letters, numbers and dashes only; no dash at the start or end.',
    className: 'kk-hint !text-ink',
  },
  checking: { text: 'Checking…', className: 'kk-hint' },
  available: { text: 'Available', className: 'kk-hint kk-hint--ok' },
  taken: { text: 'This handle is already taken.', className: 'kk-hint !text-ink' },
  unknown: { text: 'Could not check availability — it will be checked on save.', className: 'kk-hint' },
}

/** The logged-in person: display name and handle. */
export function AccountForm({ me }: { me: AccountMe }) {
  const router = useRouter()
  const [displayName, setDisplayName] = useState(me.display_name)
  const [handle, setHandle] = useState(me.handle)
  const [handleState, setHandleState] = useState<HandleState>('current')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (handle === me.handle) return setHandleState('current')
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
  }, [handle, me.handle])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/accounts/me`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: displayName, handle }),
      })
      const json = (await res.json()) as { data?: unknown; error?: { code?: string; message: string } }
      if (!res.ok || !json.data) {
        setError(
          json.error?.code === 'handle_taken'
            ? 'This handle is already taken.'
            : (json.error?.message ?? `Request failed (${res.status})`),
        )
        return
      }
      setSaved(true)
      router.refresh()
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
            maxLength={200}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="kk-input"
          />
        </label>

        <label className="kk-field">
          Handle
          <input
            required
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
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
      </div>

      {error && (
        <div className="kk-alert" role="alert">
          {error}
        </div>
      )}

      <div className="flex items-center gap-4">
        <button type="submit" disabled={busy || blocked} className="kk-btn kk-btn--primary kk-btn--lg">
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="kk-hint kk-hint--ok text-[14px] font-bold">Saved.</span>}
      </div>
    </form>
  )
}
