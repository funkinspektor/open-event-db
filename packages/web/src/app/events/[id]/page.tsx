import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { canEdit as canEditEvent } from '@open-event-db/shared'
import { getEvent, isUuid } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { absoluteUrl, shareMetadata } from '@/lib/site'
import { formatDate, formatDateTime, formatTimeRange } from '@/lib/format'
import { describeRecurrence } from '@/lib/recurrence'
import { markdownToPlainText } from '@/lib/plaintext'
import { Markdown } from '@/components/Markdown'
import { StatusBanner } from '@/components/StatusBadge'
import { LinkButtons } from '@/components/LinkButtons'
import { Map } from '@/components/Map'
import { JsonLd } from '@/components/JsonLd'
import { Headline } from '@/components/Headline'
import { Toast } from '@/components/Toast'

type Params = Promise<{ id: string }>
type SearchParams = Promise<{ saved?: string }>

const SAVED_MESSAGES: Record<string, string> = {
  created: 'Event created — it’s live now.',
  updated: 'Changes saved.',
}

async function load(params: Params) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const event = await getEvent(id)
  if (!event) notFound()
  return event
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const e = await load(params)
  const where = e.venue?.name ?? e.location_text ?? e.city
  const description = `${formatDateTime(e.starts_at, e.ends_at)} · ${where} · ${e.city}`
  return {
    title: e.title,
    description,
    ...shareMetadata(`/events/${e.id}`, e.title, description),
  }
}

const SCHEMA_STATUS = {
  scheduled: 'https://schema.org/EventScheduled',
  postponed: 'https://schema.org/EventPostponed',
  cancelled: 'https://schema.org/EventCancelled',
} as const

export default async function EventPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [e, me, { saved }] = await Promise.all([load(params), getCurrentPublisher(), searchParams])
  const savedMessage = saved ? SAVED_MESSAGES[saved] : undefined
  const canEdit = !!me && canEditEvent(e, me)
  // Show who added a claimed event only when it wasn't one of its owners (i.e. a scout)
  const addedByOther = e.claimed && !e.owners.some((o) => o.publisher_id === e.added_by.id)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    url: absoluteUrl(`/events/${e.id}`),
    description: e.description ? markdownToPlainText(e.description) : undefined,
    startDate: e.starts_at,
    ...(e.ends_at ? { endDate: e.ends_at } : {}),
    eventStatus: SCHEMA_STATUS[e.status],
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: e.venue
      ? {
          '@type': 'Place',
          name: e.venue.name,
          address: `${e.venue.address}, ${e.venue.city}`,
          ...(e.venue.coordinates
            ? {
                geo: {
                  '@type': 'GeoCoordinates',
                  latitude: e.venue.coordinates.lat,
                  longitude: e.venue.coordinates.lng,
                },
              }
            : {}),
        }
      : { '@type': 'Place', name: e.location_text ?? e.city, address: e.city },
    // Unclaimed events have no confirmed organizer — the scout who added them isn't one
    ...(e.claimed
      ? {
          organizer: e.owners.map((o) => ({
            '@type': 'Organization',
            name: o.name,
            url: absoluteUrl(`/publishers/${o.slug}`),
          })),
        }
      : {}),
  }

  return (
    <article className="kk-container" style={{ gap: 52 }}>
      <JsonLd data={jsonLd} />
      {savedMessage && canEdit && <Toast message={savedMessage} param="saved" />}

      <StatusBanner status={e.status} />

      <header className="kk-intro" style={{ gap: 16 }}>
        <p className="kk-eyebrow kk-eyebrow--live">{formatDate(e.starts_at, true)}</p>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Headline text={e.title} className="max-w-[900px]" style={{ fontSize: 'clamp(56px, 8vw, 104px)' }} />
          {canEdit && (
            <Link href={`/events/${e.id}/edit`} className="kk-btn kk-btn--outline">
              Edit event
            </Link>
          )}
        </div>
        <p className="m-0 text-[20px]">
          <span className="font-bold tabular-nums">{formatTimeRange(e.starts_at, e.ends_at, ' – ')}</span>
          {e.recurrence && (
            <>
              {' '}
              <span className="text-border">·</span> <span className="text-muted">{describeRecurrence(e.recurrence)}</span>
            </>
          )}
        </p>
        {e.tags.length > 0 && (
          <div className="kk-pills" style={{ gap: 6 }}>
            {e.tags.map((t) => (
              <Link key={t} href={`/?tags=${encodeURIComponent(t)}`} className="kk-tag kk-tag--filter">
                {t}
              </Link>
            ))}
          </div>
        )}
      </header>

      <hr className="kk-rule" />

      <div className="flex flex-wrap items-start gap-12">
        <div className="flex min-w-0 flex-col gap-10" style={{ flex: '999 1 520px' }}>
          {e.description && (
            <section>
              <h2 className="sr-only">Description</h2>
              <Markdown text={e.description} className="max-w-[680px] text-body-long text-ink-soft" />
            </section>
          )}

          {Object.keys(e.links).length > 0 && (
            <section className="flex flex-col gap-3.5">
              <h2 className="kk-eyebrow">Links</h2>
              <LinkButtons links={e.links} primary="tickets" />
            </section>
          )}

          {e.claimed ? (
            <section className="flex flex-col gap-3.5">
              <h2 className="kk-eyebrow">Organised by</h2>
              <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-[17px]">
                {e.owners.map((o) => (
                  <li key={o.publisher_id}>
                    <Link href={`/publishers/${o.slug}`} className="font-bold">
                      {o.name}
                    </Link>
                    {o.role === 'co_owner' && <span className="text-muted"> (co-host)</span>}
                  </li>
                ))}
              </ul>
              {addedByOther && (
                <p className="m-0 text-[14px] text-muted">
                  Added by {e.added_by.name}
                  {e.added_by.is_scout && ' · Scout'}
                </p>
              )}
            </section>
          ) : (
            <section className="flex flex-col gap-3.5">
              <h2 className="kk-eyebrow">Added by</h2>
              <p className="m-0 text-[17px]">
                <span className="font-bold">{e.added_by.name}</span>
                {e.added_by.is_scout && <span className="text-muted"> · Scout</span>}
              </p>
              <p className="m-0 text-[14px] text-muted">Not yet confirmed by the organizer</p>
            </section>
          )}
        </div>

        <aside className="flex max-w-[380px] flex-col gap-3.5" style={{ flex: '1 1 300px' }}>
          <h2 className="kk-eyebrow">Location</h2>
          {e.venue ? (
            <>
              <div>
                <Link href={`/venues/${e.venue.id}`} className="kk-listlink__name" style={{ fontSize: 30 }}>
                  {e.venue.name}
                </Link>
                <div className="mt-2 leading-normal text-muted">
                  {e.venue.address}
                  <br />
                  {e.venue.city}
                </div>
              </div>
              {e.venue.coordinates && (
                <Map lat={e.venue.coordinates.lat} lng={e.venue.coordinates.lng} title={e.venue.name} />
              )}
            </>
          ) : (
            <div>
              <span className="kk-listlink__name" style={{ fontSize: 30 }}>
                {e.location_text ?? 'Location TBA'}
              </span>
              <div className="mt-2 text-muted">{e.city}</div>
            </div>
          )}
        </aside>
      </div>
    </article>
  )
}
