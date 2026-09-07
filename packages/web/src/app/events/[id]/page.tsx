import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getEvent, isUuid } from '@/lib/api'
import { describeRecurrence, formatDate, formatDateTime, formatTimeRange } from '@/lib/format'
import { StatusBanner } from '@/components/StatusBadge'
import { LinkButtons } from '@/components/LinkButtons'
import { Map } from '@/components/Map'
import { JsonLd } from '@/components/JsonLd'

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
  const e = await load(params)

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
    <article className="space-y-8">
      <JsonLd data={jsonLd} />

      <StatusBanner status={e.status} />

      <header className="space-y-3">
        <p className="text-sm font-medium text-violet-700">
          {formatDate(e.starts_at, true)}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{e.title}</h1>
        <p className="text-lg text-neutral-700">
          <span className="tabular-nums">{formatTimeRange(e.starts_at, e.ends_at)}</span>
          {e.recurrence && (
            <>
              <span className="mx-2 text-neutral-300">·</span>
              <span className="text-neutral-600">{describeRecurrence(e.recurrence)}</span>
            </>
          )}
        </p>
        {e.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {e.tags.map((t) => (
              <li key={t}>
                <Link
                  href={`/?tags=${encodeURIComponent(t)}`}
                  className="inline-block rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-700 hover:bg-neutral-200"
                >
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="grid gap-8 md:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          {e.description && (
            <section>
              <h2 className="sr-only">Description</h2>
              <p className="whitespace-pre-wrap leading-relaxed text-neutral-800">{e.description}</p>
            </section>
          )}

          {Object.keys(e.links).length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Links</h2>
              <LinkButtons links={e.links} />
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
              Organised by
            </h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {e.owners.map((o) => (
                <li key={o.publisher_id} className="text-sm">
                  <Link href={`/publishers/${o.slug}`} className="font-medium hover:underline">
                    {o.name}
                  </Link>
                  {o.role === 'co_owner' && (
                    <span className="ml-1 text-neutral-500">(co-host)</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Location</h2>
          {e.venue ? (
            <>
              <div className="text-sm">
                <Link href={`/venues/${e.venue.id}`} className="font-semibold hover:underline">
                  {e.venue.name}
                </Link>
                <div className="text-neutral-600">{e.venue.address}</div>
                <div className="text-neutral-600">{e.venue.city}</div>
              </div>
              {e.venue.coordinates && (
                <Map lat={e.venue.coordinates.lat} lng={e.venue.coordinates.lng} title={e.venue.name} />
              )}
            </>
          ) : (
            <div className="text-sm">
              <div className="font-semibold">{e.location_text ?? 'Location TBA'}</div>
              <div className="text-neutral-600">{e.city}</div>
            </div>
          )}
        </aside>
      </div>
    </article>
  )
}
