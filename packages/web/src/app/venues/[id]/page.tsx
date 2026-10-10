import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ALL_STATUSES, getEvents, getVenue, isUuid } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { EventRow } from '@/components/EventRow'
import { EventList } from '@/components/EventList'
import { LinkButtons } from '@/components/LinkButtons'
import { Map } from '@/components/Map'
import { JsonLd } from '@/components/JsonLd'
import { Headline } from '@/components/Headline'
import { BackIcon } from '@/components/Icons'

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
    <div className="kk-container" style={{ gap: 48 }}>
      <JsonLd data={jsonLd} />

      <header className="kk-intro" style={{ gap: 14 }}>
        <div className="flex items-center justify-between gap-4">
          <Link href="/venues" className="kk-eyebrow">
            <BackIcon />
            Venues
          </Link>
          {me && (
            <Link href={`/venues/${v.id}/edit`} className="kk-btn kk-btn--outline">
              Edit venue
            </Link>
          )}
        </div>
        <Headline text={v.name} />
        <p className="kk-lede max-w-none">
          {v.address} · {v.city}
        </p>
        <LinkButtons links={v.links} />
      </header>

      <div className="flex flex-wrap items-start gap-12">
        <div className="flex min-w-0 flex-col gap-10" style={{ flex: '999 1 560px' }}>
          <section>
            <h2 className="kk-section-title">Upcoming events</h2>
            <hr className="kk-rule" />
            <EventList
              initialEvents={events.data}
              initialCursor={events.meta.cursor}
              apiQuery={apiQuery.toString()}
              emptyMessage="No upcoming events at this venue."
              meta="tags"
              showTags={false}
              titleSize={21}
            />
          </section>

          {past.length > 0 && (
            <details className="kk-disclosure">
              <summary>
                <span className="kk-section-title">Past events</span>
                <span className="kk-disclosure__count">
                  ({past.length}
                  {pastEvents.meta.has_more ? '+' : ''})
                </span>
              </summary>
              <div className="mt-6">
                <hr className="kk-rule" />
                {past.map((e) => (
                  <EventRow key={e.id} event={e} showDate meta="tags" showTags={false} titleSize={21} />
                ))}
              </div>
            </details>
          )}
        </div>
        {v.coordinates && (
          <aside className="w-full max-w-[380px]" style={{ flex: '1 1 300px' }}>
            <Map lat={v.coordinates.lat} lng={v.coordinates.lng} title={v.name} height={320} />
          </aside>
        )}
      </div>
    </div>
  )
}
