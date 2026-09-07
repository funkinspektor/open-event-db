'use client'

import { useState } from 'react'
import type { EventSlim } from '@open-event-db/shared'
import { EventCard } from './EventCard'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface Props {
  initialEvents: EventSlim[]
  initialCursor: string | null
  apiQuery: string
  emptyMessage?: string
}

export function EventList({
  initialEvents,
  initialCursor,
  apiQuery,
  emptyMessage = 'No events match these filters.',
}: Props) {
  const [events, setEvents] = useState(initialEvents)
  const [cursor, setCursor] = useState(initialCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadMore() {
    if (!cursor) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/v1/events?${apiQuery}&cursor=${encodeURIComponent(cursor)}`)
      if (!res.ok) throw new Error(`API ${res.status}`)
      const json = (await res.json()) as { data: EventSlim[]; meta: { cursor: string | null } }
      setEvents((prev) => [...prev, ...json.data])
      setCursor(json.meta.cursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more')
    } finally {
      setLoading(false)
    }
  }

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {events.map((e) => (
        <EventCard key={e.id} event={e} />
      ))}
      {cursor && (
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
