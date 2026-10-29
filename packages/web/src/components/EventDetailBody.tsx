import Link from 'next/link'
import type { z } from 'zod'
import type { EventCategory, EventStatus, venueDetailEmbedSchema } from '@open-event-db/shared'
import { categoryLabel } from '@/lib/categories'
import { formatDate, formatTimeRange } from '@/lib/format'
import { describeRecurrence } from '@/lib/recurrence'
import { Markdown } from './Markdown'
import { StatusBanner } from './StatusBadge'
import { LinkButtons } from './LinkButtons'
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
  links: Record<string, string>
  venue: z.infer<typeof venueDetailEmbedSchema> | null
  locationText: string | null
  city: string
  imageUrl: string | null
  /** Next to the title, e.g. "Edit event". */
  headerAction?: React.ReactNode
  /** Below the links in the main column, e.g. who organises the event. */
  children?: React.ReactNode
}

/** An event page from status banner to location: shared by real events and the inbox preview of feed items. */
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
  links,
  venue,
  locationText,
  city,
  imageUrl,
  headerAction,
  children,
}: Props) {
  const category = categoryLabel(categories)
  const image = imageUrl && (
    <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="kk-event-image">
      {/* No referrer: the inbox preview shows feed images straight from their host */}
      <img src={imageUrl} alt={`Image for ${title}`} referrerPolicy="no-referrer" />
    </a>
  )

  return (
    <>
      <StatusBanner status={status} />

      <header className="kk-intro" style={{ gap: 16 }}>
        <p className="kk-eyebrow kk-eyebrow--live">{formatDate(startsAt, true)}</p>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Headline text={title} className="max-w-[900px]" style={{ fontSize: 'clamp(56px, 8vw, 104px)' }} />
          {headerAction}
        </div>
        <p className="m-0 text-[20px]">
          <span className="font-bold tabular-nums">{formatTimeRange(startTimeKnown ? startsAt : null, endsAt, ' – ')}</span>
          {recurrence && (
            <>
              {' '}
              <span className="text-border">·</span> <span className="text-muted">{describeRecurrence(recurrence)}</span>
            </>
          )}
        </p>
        {(category || tags.length > 0) && (
          <div className="kk-pills" style={{ gap: 6 }}>
            {category && <span className="kk-badge kk-badge--category">{category}</span>}
            {tags.map((t) => (
              <Link key={t} href={`/?tags=${encodeURIComponent(t)}`} className="kk-tag kk-tag--filter">
                {t}
              </Link>
            ))}
          </div>
        )}
      </header>

      <hr className="kk-rule" />

      {/* Narrow layouts stack the aside below the text, so the image goes first there */}
      {image && <div className="max-w-[380px] lg:hidden">{image}</div>}

      <div className="flex flex-wrap items-start gap-12">
        <div className="flex min-w-0 flex-col gap-10" style={{ flex: '999 1 520px' }}>
          {description && (
            <section>
              <h2 className="sr-only">Description</h2>
              <Markdown text={description} className="max-w-[680px] text-body-long text-ink-soft" />
            </section>
          )}

          {Object.keys(links).length > 0 && (
            <section className="flex flex-col gap-3.5">
              <h2 className="kk-eyebrow">Links</h2>
              <LinkButtons links={links} primary="tickets" />
            </section>
          )}

          {children}
        </div>

        <aside className="flex max-w-[380px] flex-col gap-3.5" style={{ flex: '1 1 300px' }}>
          {image && <div className="mb-6 hidden lg:block">{image}</div>}
          <h2 className="kk-eyebrow">Location</h2>
          {venue ? (
            <>
              <div>
                <Link href={`/venues/${venue.id}`} className="kk-listlink__name" style={{ fontSize: 30 }}>
                  {venue.name}
                </Link>
                <div className="mt-2 leading-normal text-muted">
                  {venue.address}
                  <br />
                  {venue.city}
                </div>
              </div>
              {venue.coordinates && <Map lat={venue.coordinates.lat} lng={venue.coordinates.lng} title={venue.name} />}
            </>
          ) : (
            <div>
              <span className="kk-listlink__name" style={{ fontSize: 30 }}>
                {locationText ?? 'Location TBA'}
              </span>
              <div className="mt-2 text-muted">{city}</div>
            </div>
          )}
        </aside>
      </div>
    </>
  )
}
