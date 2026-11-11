'use client'

import { useEffect, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type Orphan = { id: string; name: string; slug: string }

/** Permanent account deletion, gated by typing the handle. Lists organizers that would be left without an owner. */
export function DeleteAccountSection({ handle }: { handle: string }) {
  const [orphans, setOrphans] = useState<Orphan[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${API_URL}/api/v1/accounts/me/delete-preview`, { credentials: 'include', signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) return setLoadFailed(true)
        const json = (await res.json()) as { data: { orphaned_organizers: Orphan[] } }
        setOrphans(json.data.orphaned_organizers)
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setLoadFailed(true)
      })
    return () => ctrl.abort()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/accounts/me`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm_handle: typed }),
      })
      if (res.ok) {
        // Full reload so the header drops the account menu.
        window.location.assign('/goodbye')
        return
      }
      const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
      setError(
        json.error?.code === 'confirm_mismatch'
          ? 'That doesn’t match your handle.'
          : (json.error?.message ?? `Request failed (${res.status})`),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="kk-section-title">Delete account</h2>
      <form onSubmit={submit} className="kk-panel">
        <p className="m-0 text-body text-muted">
          This permanently deletes your personal data, your interests and your calendar link. Events you added stay,
          shown as “Added by Deleted account”. It can’t be undone.
        </p>
        {orphans && orphans.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="m-0 text-body">These organizers would be left without members:</p>
            <ul className="m-0 pl-5 text-body">
              {orphans.map((o) => (
                <li key={o.id}>{o.name}</li>
              ))}
            </ul>
          </div>
        )}
        {loadFailed && (
          <p className="kk-hint m-0">Could not check which organizers this affects. Deleting still works.</p>
        )}
        <label className="kk-field">
          Type your handle <span className="font-medium text-ink">{handle}</span> to confirm
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="kk-input"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {error && (
          <div className="kk-alert" role="alert">
            {error}
          </div>
        )}
        <div>
          <button type="submit" disabled={busy || typed !== handle} className="kk-btn kk-btn--secondary">
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </form>
    </section>
  )
}
