'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IngestItemView } from '@open-event-db/shared'
import { ingestAction } from '@/lib/ingest-actions'
import { IngestItemCard } from './IngestItemCard'
import { Toast } from './Toast'

interface Props {
  items: IngestItemView[]
  view: 'new' | 'gone'
}

interface ToastState {
  id: number
  message: string
  action?: { href: string; label: string }
}

/** The scout's review list with its actions; every change goes to the API, then the page refreshes. */
export function IngestInbox({ items, view }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  // Items that were decided elsewhere drop out of the selection once the list refreshes.
  const ids = new Set(items.map((i) => i.id))
  const picked = [...selected].filter((id) => ids.has(id))

  async function call<T>(path: string, body: unknown, affected: string[]): Promise<T | null> {
    setError(null)
    setBusy((prev) => new Set([...prev, ...affected]))
    try {
      const result = await ingestAction<T>(path, body)
      if ('data' in result) return result.data
      setError(result.error)
      // e.g. 409 because someone else decided it first — show the current state
      if (result.status === 409) router.refresh()
      return null
    } finally {
      setBusy((prev) => new Set([...prev].filter((id) => !affected.includes(id))))
    }
  }

  function showEvent(message: string, eventId: string) {
    setToast({ id: Date.now(), message, action: { href: `/events/${eventId}`, label: 'Open event' } })
  }

  async function accept(item: IngestItemView) {
    const data = await call<{ event_id: string }>(`items/${item.id}/accept`, {}, [item.id])
    if (!data) return
    showEvent('Accepted —', data.event_id)
    router.refresh()
  }

  async function reject(rejectIds: string[]) {
    const data = await call<{ rejected: number }>('items/reject', { ids: rejectIds }, rejectIds)
    if (!data) return
    setSelected(new Set())
    router.refresh()
  }

  // Linking first compares the two, on the item's own page
  function link(item: IngestItemView, eventId: string) {
    router.push(`/ingest/${item.id}?merge=${eventId}`)
  }

  async function gone(item: IngestItemView, action: 'cancel' | 'keep') {
    const data = await call<{ ok: true }>(`items/${item.id}/gone`, { action }, [item.id])
    if (!data) return
    router.refresh()
  }

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const allPicked = items.length > 0 && picked.length === items.length

  return (
    <section className="flex flex-col gap-6">
      {error && (
        <div className="kk-alert" role="alert">
          {error}
        </div>
      )}

      {view === 'new' && items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className="flex cursor-pointer items-center gap-3 text-[15px]">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
              className="h-5 w-5 accent-[var(--uv)]"
            />
            Select all
          </label>
          <button
            type="button"
            onClick={() => reject(picked)}
            disabled={picked.length === 0 || picked.some((id) => busy.has(id))}
            className="kk-btn kk-btn--outline"
          >
            Reject{picked.length > 0 ? ` ${picked.length} selected` : ' selected'}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="kk-empty">{view === 'new' ? 'Nothing new.' : 'Nothing gone from a source.'}</p>
      ) : (
        <div>
          <hr className="kk-rule" />
          {items.map((item) => (
            <IngestItemCard
              key={item.id}
              item={item}
              view={view}
              selected={selected.has(item.id)}
              busy={busy.has(item.id)}
              onSelect={(on) => toggle(item.id, on)}
              onAccept={() => accept(item)}
              onReject={() => reject([item.id])}
              onLink={(eventId) => link(item, eventId)}
              onGone={(action) => gone(item, action)}
            />
          ))}
        </div>
      )}

      {toast && <Toast key={toast.id} message={toast.message} action={toast.action} />}
    </section>
  )
}
