import Link from 'next/link'
import type { EventSlim } from '@open-event-db/shared'
import { categoryLabel } from '@/lib/categories'
import { dayKey, formatDay, formatRowDate, formatTime, formatTimeRange, isHappeningNow, knownStart } from '@/lib/format'
import { InterestToggle } from './InterestToggle'
import { StatusBadge } from './StatusBadge'

interface Props {
  event: EventSlim
  /** Put the date above the time — everywhere except the day-grouped home list. */
  showDate?: boolean
  /** Second line after the category: venue · city (default) or the tags (venue page). */
  meta?: 'venue' | 'tags'
  /** Tags as chips in the aside. */
  showTags?: boolean
  /** Replaces the tags in the aside, e.g. the dashboard's Edit button. */
  action?: React.ReactNode
  titleSize?: number
  now?: Date
  /** In the home list's Ongoing section: since when and until when, instead of the day's times. */
  ongoing?: boolean
  /** Shows the interest star: whether the logged-in account marked the event, or `null` when logged out. Omitted = no star. */
  interested?: boolean | null
}

/** Ongoing rows: "until 05:00" when it ends today, "until Sun 30.11" when later. */
function ongoingUntil(event: EventSlim, now: Date): string {
  if (!event.ends_at) return formatTimeRange(knownStart(event), null)
  return dayKey(event.ends_at) === dayKey(now.toISOString())
    ? `until ${formatTime(event.ends_at)}`
    : `until ${formatDay(event.ends_at)}`
}

// Flyer-style event row: time | title + venue | badges and tags.
export function EventRow({
  event,
  showDate = false,
  meta = 'venue',
  showTags = true,
  action,
  titleSize,
  now = new Date(),
  ongoing = false,
  interested,
}: Props) {
  const running = event.status !== 'cancelled' && isHappeningNow(event, now)
  const cancelled = event.status === 'cancelled'
  const category = categoryLabel(event.categories)
  const cls = `kk-event${running ? ' kk-event--now' : ''}${cancelled ? ' kk-event--cancelled' : ''}`

  return (
    <article className={cls}>
      <div className="kk-event__when">
        {showDate && (
          <span className="kk-event__date">
            {running ? 'Now' : ongoing ? `Since ${formatDay(event.starts_at)}` : formatRowDate(event.starts_at, now)}
          </span>
        )}
        <span className="kk-event__time">
          {ongoing ? ongoingUntil(event, now) : formatTimeRange(knownStart(event), event.ends_at)}
        </span>
      </div>
      <div className={`kk-event__main${event.image_url ? ' kk-event__main--thumb' : ''}`}>
        <div className="min-w-0">
          <h3 className="kk-event__title" style={titleSize ? { fontSize: titleSize } : undefined}>
            <Link href={`/events/${event.id}`}>{event.title}</Link>
          </h3>
          {meta === 'venue' ? (
            <p className="kk-event__meta">
              {category && <>{category} · </>}
              {event.venue ? (
                <Link href={`/venues/${event.venue.id}`}>{event.venue.name}</Link>
              ) : (
                (event.location_text ?? 'Location TBA')
              )}{' '}
              · {event.venue?.city ?? event.city}
            </p>
          ) : (
            (category || event.tags.length > 0) && (
              <p className="kk-event__meta">{[category, ...event.tags].filter(Boolean).join(' · ')}</p>
            )
          )}
        </div>
        {event.image_url && (
          <span className="kk-thumb kk-thumb--row" aria-hidden="true">
            <img src={event.image_url} alt="" loading="lazy" />
          </span>
        )}
      </div>
      <div className="kk-event__aside">
        {running && <span className="kk-badge kk-badge--now">● Happening now</span>}
        <StatusBadge status={event.status} />
        {action ??
          (showTags &&
            event.tags.map((t) => (
              <Link key={t} className="kk-tag" href={`/?tags=${encodeURIComponent(t)}`}>
                {t}
              </Link>
            )))}
        {interested !== undefined && <InterestToggle eventId={event.id} interested={interested} />}
      </div>
    </article>
  )
}
