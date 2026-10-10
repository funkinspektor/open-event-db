'use client'

import { useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export function ApiKeySection({ hasApiKey }: { hasApiKey: boolean }) {
  const [hasKey, setHasKey] = useState(hasApiKey)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    if (hasKey) {
      const ok = window.confirm(
        'Generate a new API key? Your current key stops working immediately — anything using it (scripts, Claude, bots) needs the new one.',
      )
      if (!ok) return
    }

    setError(null)
    setCopied(false)
    setBusy(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/publishers/me/api-key`, {
        method: 'POST',
        credentials: 'include',
      })
      const json = (await res.json()) as { data?: { api_key: string }; error?: { message: string } }
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? `Request failed (${res.status})`)
        return
      }
      setNewKey(json.data.api_key)
      setHasKey(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!newKey) return
    try {
      await navigator.clipboard.writeText(newKey)
      setCopied(true)
    } catch {
      setError('Could not copy — select the key and copy it manually.')
    }
  }

  return (
    <section className="kk-panel kk-panel--dashed">
      <div className="flex flex-col gap-2">
        <p className="kk-eyebrow text-[12px]">For developers</p>
        <h2 className="kk-section-title" style={{ margin: 0, fontSize: 34 }}>
          API key
        </h2>
        <p className="m-0 text-[15px] leading-normal text-muted">
          Need to create events via the API or Claude? Generate an API key. Most publishers never need one.
        </p>
      </div>

      {newKey ? (
        <div className="flex flex-col gap-2.5 rounded-m border border-warn p-4">
          <p className="m-0 text-[15px] font-bold text-warn">Save this — you won’t see it again.</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={newKey}
              onFocus={(e) => e.currentTarget.select()}
              className="kk-input kk-input--mono w-full min-w-0"
              aria-label="Your new API key"
            />
            <button type="button" onClick={copy} className="kk-btn kk-btn--secondary shrink-0">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="kk-hint m-0">
            Send it as <code className="font-mono text-ink-soft">Authorization: Bearer …</code> with your API requests.
          </p>
        </div>
      ) : (
        hasKey && (
          <p className="m-0 font-mono text-code text-ink-soft" aria-label="API key (hidden)">
            oevt_••••••••••••••••
          </p>
        )
      )}

      {error && <p className="kk-error">{error}</p>}

      <button type="button" onClick={generate} disabled={busy} className="kk-btn kk-btn--outline self-start">
        {busy ? 'Generating…' : hasKey ? 'Generate new key' : 'Generate API key'}
      </button>
    </section>
  )
}
