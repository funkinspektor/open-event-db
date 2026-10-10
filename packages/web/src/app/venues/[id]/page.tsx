import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ALL_STATUSES, getEvents, getVenue, isUuid } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { EventCard } from '@/components/EventCard'
import { EventList } from '@/components/EventList'
import { LinkButtons } from '@/components/LinkButtons'
import { Map } from '@/components/Map'
import { JsonLd } from '@/components/JsonLd'

type Params = Promise<{ id: string }>

async function load(params: Params) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const venue = await getVenue(id)
  if (!venue) notFound()
  return venue
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const v = await load(params)
  const description = `${v.address} · ${v.city}`
  return {
    title: v.name,
    description,
    openGraph: { title: v.name, description, type: 'website' },
    twitter: { card: 'summary', title: v.name, description },
  }
}

export default async function VenuePage({ params }: { params: Params }) {
  const v = await load(params)

  const apiQuery = new URLSearchParams({ status: ALL_STATUSES, venue_id: v.id, limit: '20' })
  // The API only sorts ascending, so past events are fetched in one page and reversed.
  const pastQuery = new URLSearchParams({
    status: ALL_STATUSES,
    venue_id: v.id,
    from: '2000-01-01T00:00:00Z',
    to: new Date().toISOString(),
    limit: '100',
  })
  const [events, pastEvents, me] = await Promise.all([
    getEvents(apiQuery),
    getEvents(pastQuery),
    getCurrentPublisher(),
  ])
  const past = [...pastEvents.data].reverse()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: v.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: v.address,
      addressLocality: v.city,
    },
    ...(v.coordinates
      ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: v.coordinates.lat,
            longitude: v.coordinates.lng,
          },
        }
      : {}),
  }

  return (
    <div className="space-y-8">
      <JsonLd data={jsonLd} />

      <header className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            <Link href="/venues" className="hover:text-neutral-900">
              Venues
            </Link>
          </p>
          {me && (
            <Link
              href={`/venues/${v.id}/edit`}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Edit venue
            </Link>
          )}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{v.name}</h1>
        <p className="text-neutral-600">
          {v.address} · {v.city}
        </p>
        <LinkButtons links={v.links} />
      </header>

      <div className="grid gap-8 md:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Upcoming events</h2>
            <EventList
              initialEvents={events.data}
              initialCursor={events.meta.cursor}
              apiQuery={apiQuery.toString()}
              emptyMessage="No upcoming events at this venue."
            />
          </section>

          {past.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-lg font-semibold text-neutral-600 hover:text-neutral-900">
                Past events{' '}
                <span className="text-sm font-normal text-neutral-400">
                  ({past.length}
                  {pastEvents.meta.has_more ? '+' : ''})
                </span>
              </summary>
              <div className="mt-3 space-y-3">
                {past.map((e) => (
                  <EventCard key={e.id} event={e} />
                ))}
              </div>
            </details>
          )}
        </div>
        <aside>
          {v.coordinates && <Map lat={v.coordinates.lat} lng={v.coordinates.lng} title={v.name} />}
        </aside>
      </div>
    </div>
  )
}
