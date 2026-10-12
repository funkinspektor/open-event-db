'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EventDetail, PublisherPublic } from '@open-event-db/shared'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type Owner = EventDetail['owners'][number]

interface Props {
  eventId: string
  owners: Owner[]
}

/**
 * Creator-only co-host management. Unlike the event form, every change here goes to the API
 * immediately (POST/DELETE /events/:id/owners) — there is no separate "save" step.
 */
export function CoOwnersEditor({ eventId, owners: initialOwners }: Props) {
  const router = useRouter()
  const [owners, setOwners] = useState(initialOwners)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PublisherPublic[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const coOwners = owners.filter((o) => o.role === 'co_owner')
  const ownerIds = new Set(owners.map((o) => o.publisher_id))
  const candidates = results.filter((p) => !ownerIds.has(p.id))

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: '8' })
        const res = await fetch(`${API_URL}/api/v1/publishers?${params}`, { signal: ctrl.signal })
        if (!res.ok) return
        setResults(((await res.json()) as { data: PublisherPublic[] }).data)
      } catch {
        // aborted or offline — keep previous results
      }
    }, 200)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  async function call(method: 'POST' | 'DELETE', path: string, body?: unknown) {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/events/${eventId}/owners${path}`, {
        method,
        credentials: 'include',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const json = (await res.json()) as { data?: EventDetail; error?: { message: string } }
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? `Request failed (${res.status})`)
        return
      }
      setOwners(json.data.owners)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  async function add(p: PublisherPublic) {
    setOpen(false)
    setQuery('')
    await call('POST', '', { publisher_id: p.id })
  }

  async function remove(o: Owner) {
    if (!window.confirm(`Remove ${o.name} as co-host? They will no longer be able to edit this event.`)) return
    await call('DELETE', `/${o.publisher_id}`)
  }

  return (
    <section className="kk-panel" aria-labelledby="co-hosts-title">
      <div className="flex flex-col gap-1.5">
        <h2 id="co-hosts-title" className="m-0 font-display text-[28px] font-normal leading-none">
          Co-hosts
        </h2>
        <p className="kk-hint m-0">
          Co-hosts can edit this event but can’t cancel it or manage co-hosts. Changes here apply immediately.
        </p>
      </div>

      {coOwners.length > 0 ? (
        <ul className="kk-options">
          {coOwners.map((o) => (
            <li key={o.publisher_id} className="kk-linkrow items-center">
              <span className="min-w-0 flex-1 truncate text-[15px]">
                {o.name} <span className="text-muted">· {o.slug}</span>
              </span>
              <button
                type="button"
                onClick={() => remove(o)}
                disabled={busy}
                className="kk-iconbtn"
                aria-label={`Remove ${o.name} as co-host`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[15px] text-muted">No co-hosts yet.</p>
      )}

      <div ref={boxRef} className="relative">
        <label className="kk-field">
          Add co-host
          <input
            role="combobox"
            aria-expanded={open && query.trim().length > 0}
            aria-controls={listId}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter') e.preventDefault()
            }}
            disabled={busy}
            placeholder="Search publishers by name…"
            autoComplete="off"
            className="kk-input"
          />
        </label>
        {open && query.trim() && (
          <ul id={listId} role="listbox" className="kk-listbox">
            {candidates.map((p) => (
              <li key={p.id} role="option" aria-selected={false}>
                <button type="button" onClick={() => add(p)} className="kk-option">
                  {p.name} <span className="kk-option__meta">· {p.slug}</span>
                </button>
              </li>
            ))}
            {candidates.length === 0 && (
              <li className="px-3 py-2.5 text-[15px] font-normal text-muted">
                No other publisher matches “{query.trim()}”.
              </li>
            )}
          </ul>
        )}
      </div>

      {error && (
        <div className="kk-alert" role="alert">
          {error}
        </div>
      )}
    </section>
  )
}
