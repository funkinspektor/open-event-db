import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ALL_STATUSES, getEvents, getVenue, isUuid } from '@/lib/api'
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
  const events = await getEvents(apiQuery)

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
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">Venue</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{v.name}</h1>
        <p className="text-neutral-600">
          {v.address} · {v.city}
        </p>
        <LinkButtons links={v.links} />
      </header>

      <div className="grid gap-8 md:grid-cols-[1fr_320px]">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Upcoming events</h2>
          <EventList
            initialEvents={events.data}
            initialCursor={events.meta.cursor}
            apiQuery={apiQuery.toString()}
            emptyMessage="No upcoming events at this venue."
          />
        </section>
        <aside>
          {v.coordinates && <Map lat={v.coordinates.lat} lng={v.coordinates.lng} title={v.name} />}
        </aside>
      </div>
    </div>
  )
}
