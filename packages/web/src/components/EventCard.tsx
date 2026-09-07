import Link from 'next/link'
import type { EventSlim } from '@open-event-db/shared'
import { formatDate, formatTimeRange } from '@/lib/format'
import { StatusBadge } from './StatusBadge'

export function EventCard({ event }: { event: EventSlim }) {
  const cancelled = event.status === 'cancelled'
  return (
    <article
      className={`group flex gap-4 rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300 hover:shadow-sm ${
        cancelled ? 'opacity-60' : ''
      }`}
    >
      <div className="w-16 shrink-0 text-center">
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          {formatDate(event.starts_at).split(' ')[0]}
        </div>
        <div className="text-2xl font-semibold leading-tight text-neutral-900">
          {formatDate(event.starts_at).split(' ')[1]}
        </div>
        <div className="text-xs text-neutral-500">{formatDate(event.starts_at).split(' ')[2]}</div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            className={`text-base font-semibold leading-snug text-neutral-900 ${
              cancelled ? 'line-through' : ''
            }`}
          >
            <Link href={`/events/${event.id}`} className="hover:underline">
              {event.title}
            </Link>
          </h3>
          <StatusBadge status={event.status} />
        </div>

        <p className="mt-1 text-sm text-neutral-600">
          <span className="tabular-nums">{formatTimeRange(event.starts_at, event.ends_at)}</span>
          <span className="mx-1.5 text-neutral-300">·</span>
          {event.venue ? (
            <Link href={`/venues/${event.venue.id}`} className="hover:underline">
              {event.venue.name}
            </Link>
          ) : (
            <span>{event.location_text ?? 'Location TBA'}</span>
          )}
          <span className="mx-1.5 text-neutral-300">·</span>
          <span>{event.city}</span>
        </p>

        {event.tags.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {event.tags.map((t) => (
              <li key={t}>
                <Link
                  href={`/?tags=${encodeURIComponent(t)}`}
                  className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-200"
                >
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}
