import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getEvent, isUuid } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { describeRecurrence, formatDate, formatDateTime, formatTimeRange } from '@/lib/format'
import { StatusBanner } from '@/components/StatusBadge'
import { LinkButtons } from '@/components/LinkButtons'
import { Map } from '@/components/Map'
import { JsonLd } from '@/components/JsonLd'
import { Headline } from '@/components/Headline'

type Params = Promise<{ id: string }>

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
    openGraph: { title: e.title, description, type: 'website' },
    twitter: { card: 'summary', title: e.title, description },
  }
}

const SCHEMA_STATUS = {
  scheduled: 'https://schema.org/EventScheduled',
  postponed: 'https://schema.org/EventPostponed',
  cancelled: 'https://schema.org/EventCancelled',
} as const

export default async function EventPage({ params }: { params: Params }) {
  const [e, me] = await Promise.all([load(params), getCurrentPublisher()])
  const canEdit = !!me && e.owners.some((o) => o.publisher_id === me.id)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    description: e.description,
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
    organizer: e.owners.map((o) => ({
      '@type': 'Organization',
      name: o.name,
      url: `/publishers/${o.slug}`,
    })),
  }

  return (
    <article className="kk-container" style={{ gap: 52 }}>
      <JsonLd data={jsonLd} />

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
              <p className="m-0 max-w-[680px] whitespace-pre-line text-body-long text-ink-soft">{e.description}</p>
            </section>
          )}

          {Object.keys(e.links).length > 0 && (
            <section className="flex flex-col gap-3.5">
              <h2 className="kk-eyebrow">Links</h2>
              <LinkButtons links={e.links} primary="tickets" />
            </section>
          )}

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
          </section>
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
