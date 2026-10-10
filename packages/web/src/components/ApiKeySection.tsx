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
    <section className="space-y-4 rounded-xl border border-dashed border-neutral-300 p-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">For developers</p>
        <h2 className="mt-1 text-lg font-semibold">API key</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Need to create events via the API or Claude? Generate an API key. Most publishers never need one.
        </p>
      </div>

      {newKey ? (
        <div className="space-y-2 rounded-md bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Save this — you won’t see it again.</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={newKey}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-sm"
              aria-label="Your new API key"
            />
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-amber-900">
            Send it as <code className="font-mono">Authorization: Bearer …</code> with your API requests.
          </p>
        </div>
      ) : (
        hasKey && (
          <p className="font-mono text-sm text-neutral-700" aria-label="API key (hidden)">
            oevt_••••••••••••••••
          </p>
        )
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={generate}
        disabled={busy}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
      >
        {busy ? 'Generating…' : hasKey ? 'Generate new key' : 'Generate API key'}
      </button>
    </section>
  )
}
