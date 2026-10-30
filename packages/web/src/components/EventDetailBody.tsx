import Link from 'next/link'
import type { z } from 'zod'
import type { EventCategory, EventStatus, Lineup, venueDetailEmbedSchema } from '@open-event-db/shared'
import { categoryLabel } from '@/lib/categories'
import { formatEndDayMark, formatShortDate, formatTimeRange, relativeDayLabel } from '@/lib/format'
import { describeRecurrence } from '@/lib/recurrence'
import { BackIcon, NextIcon } from './Icons'
import { Markdown } from './Markdown'
import { StatusBanner } from './StatusBadge'
import { LinkButtons } from './LinkButtons'
import { LineupView } from './LineupView'
import { Map } from './Map'
import { Headline } from './Headline'

interface Props {
  title: string
  startsAt: string
  /** False when only the day is known; feed items in the inbox always have a time. */
  startTimeKnown?: boolean
  endsAt: string | null
  status: EventStatus
  recurrence: string | null
  categories: EventCategory[]
  tags: string[]
  description: string
  lineup: Lineup
  links: Record<string, string>
  venue: z.infer<typeof venueDetailEmbedSchema> | null
  locationText: string | null
  city: string
  imageUrl: string | null
  /** The row above the title: a back link on the left, e.g. "Edit event" on the right. */
  back?: { href: string; label: string }
  topAction?: React.ReactNode
  /** Below the text in the main column, e.g. who organises the event. */
  children?: React.ReactNode
}

/** "19:00 – 11:30 (Sat)", "From 23:00"; null when neither the start nor the end time is known. */
function timeLine(startsAt: string, startTimeKnown: boolean, endsAt: string | null): string | null {
  if (!startTimeKnown) return endsAt ? formatTimeRange(null, endsAt) : null
  if (!endsAt) return `From ${formatTimeRange(startsAt, null)}`
  const mark = formatEndDayMark(startsAt, endsAt)
  return `${formatTimeRange(startsAt, endsAt, ' – ')}${mark ? ` (${mark})` : ''}`
}

/**
 * An event page from status banner to source: title, when, where, then image, lineup, text, links and map.
 * Shared by real events and the inbox preview of feed items. Phones get one column in that order; wide
 * screens move image, map and links into the sidebar.
 */
export function EventDetailBody({
  title,
  startsAt,
  startTimeKnown = true,
  endsAt,
  status,
  recurrence,
  categories,
  tags,
  description,
  lineup,
  links,
  venue,
  locationText,
  city,
  imageUrl,
  back,
  topAction,
  children,
}: Props) {
  const category = categoryLabel(categories)
  const time = timeLine(startsAt, startTimeKnown, endsAt)
  const hasLinks = Object.keys(links).length > 0
  const image = imageUrl && (
    <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="kk-event-image">
      {/* No referrer: the inbox preview shows feed images straight from their host */}
      <img src={imageUrl} alt={`Image for ${title}`} referrerPolicy="no-referrer" />
    </a>
  )
  const map = venue?.coordinates && <Map lat={venue.coordinates.lat} lng={venue.coordinates.lng} title={venue.name} />
  const linkSection = hasLinks && (
    <section className="flex flex-col gap-3.5">
      <h2 className="kk-eyebrow">Links</h2>
      <LinkButtons links={links} primary="tickets" />
    </section>
  )

  return (
    <>
      <StatusBanner status={status} />

      {(back || topAction) && (
        <div className="kk-event-top">
          {back ? (
            <Link href={back.href} className="kk-btn kk-btn--text">
              <BackIcon />
              {back.label}
            </Link>
          ) : (
            <span />
          )}
          {topAction}
        </div>
      )}

      <header className="flex flex-col gap-3">
        <Headline text={title} className="kk-headline--event" />
        {category && <p className="kk-eyebrow">{category}</p>}
      </header>

      <section className="flex flex-col gap-5" aria-label="When and where">
        <div className="kk-event-facts">
          <div className="kk-event-fact">
            <p className="kk-event-fact__main">
              {relativeDayLabel(startsAt) === 'Today' && <span className="text-uv">Today · </span>}
              {formatShortDate(startsAt)}
            </p>
            {(time || recurrence) && (
              <p className="kk-event-fact__sub">
                {time}
                {time && recurrence && ' · '}
                {recurrence && describeRecurrence(recurrence)}
              </p>
            )}
          </div>
          <div className="kk-event-fact">
            {venue ? (
              <>
                <Link href={`/venues/${venue.id}`} className="kk-event-venue">
                  {venue.name}
                  <NextIcon />
                </Link>
                <p className="kk-event-fact__sub">
                  {venue.address}, {venue.city}
                </p>
              </>
            ) : (
              <>
                <p className="kk-event-fact__main">{locationText ?? 'Location TBA'}</p>
                <p className="kk-event-fact__sub">{city}</p>
              </>
            )}
          </div>
        </div>
        {tags.length > 0 && (
          <div className="kk-pills" style={{ gap: 6 }}>
            {tags.map((t) => (
              <Link key={t} href={`/?tags=${encodeURIComponent(t)}`} className="kk-tag kk-tag--filter">
                {t}
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-start gap-12">
        <div className="flex min-w-0 flex-col gap-10" style={{ flex: '999 1 520px' }}>
          {image && <div className="max-w-[420px] lg:hidden">{image}</div>}

          {lineup.length > 0 && (
            <section className="flex flex-col gap-3.5">
              <h2 className="kk-eyebrow">Lineup</h2>
              <LineupView lineup={lineup} />
            </section>
          )}

          {description && (
            <section className="flex flex-col gap-3.5">
              <h2 className="kk-eyebrow">About</h2>
              <Markdown text={description} className="max-w-[680px] text-body-long text-ink-soft" />
            </section>
          )}

          {linkSection && <div className="lg:hidden">{linkSection}</div>}
          {map && <div className="lg:hidden">{map}</div>}

          {children}
        </div>

        {(image || map || linkSection) && (
          <aside className="hidden max-w-[380px] flex-col gap-8 lg:flex" style={{ flex: '1 1 300px' }}>
            {image}
            {map}
            {linkSection}
          </aside>
        )}
      </div>
    </>
  )
}
