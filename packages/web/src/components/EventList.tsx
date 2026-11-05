'use client'

import { useState } from 'react'
import type { EventSlim } from '@open-event-db/shared'
import { formatDay, relativeDayLabel } from '@/lib/format'
import { groupForList } from '@/lib/group'
import { EventRow } from './EventRow'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface Props {
  initialEvents: EventSlim[]
  initialCursor: string | null
  apiQuery: string
  emptyMessage?: string
  /**
   * Group under day headings (home) instead of putting the date into each row: the list's first Berlin
   * day (YYYY-MM-DD). Events that started before it go to an "Ongoing" section on top.
   */
  groupByDay?: string
  meta?: 'venue' | 'tags'
  showTags?: boolean
  titleSize?: number
}

export function EventList({
  initialEvents,
  initialCursor,
  apiQuery,
  emptyMessage = 'No events match these filters.',
  groupByDay,
  meta,
  showTags,
  titleSize,
}: Props) {
  const [events, setEvents] = useState(initialEvents)
  const [cursor, setCursor] = useState(initialCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = new Date()

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

  if (events.length === 0) return <p className="kk-empty">{emptyMessage}</p>

  const row = (e: EventSlim, ongoing = false) => (
    <EventRow
      key={e.id}
      event={e}
      showDate={!groupByDay || ongoing}
      ongoing={ongoing}
      meta={meta}
      showTags={showTags}
      titleSize={titleSize}
      now={now}
    />
  )

  const grouped = (firstDay: string) => {
    const { ongoing, days } = groupForList(events, firstDay)
    return (
      <>
        {ongoing.length > 0 && (
          <div>
            <h2 className="kk-day">Ongoing</h2>
            {ongoing.map((e) => row(e, true))}
          </div>
        )}
        {days.map((day) => {
          const label = relativeDayLabel(day.first, now)
          return (
            <div key={day.key}>
              <h2 className="kk-day">
                {formatDay(day.first)}
                {label && (
                  <span className={`kk-day__label${label === 'Today' ? ' kk-day__label--today' : ''}`}>{label}</span>
                )}
              </h2>
              {day.events.map((e) => row(e))}
            </div>
          )
        })}
      </>
    )
  }

  return (
    <div>
      {groupByDay ? grouped(groupByDay) : events.map((e) => row(e))}
      {cursor && (
        <div className="flex flex-wrap items-center gap-4 pt-7">
          <button type="button" onClick={loadMore} disabled={loading} className="kk-btn kk-btn--outline">
            {loading ? 'Loading…' : 'Load more'}
          </button>
          {error && <p className="kk-error">{error}</p>}
        </div>
      )}
    </div>
  )
}
