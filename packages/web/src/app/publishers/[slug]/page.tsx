import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ALL_STATUSES, getEvents, getPublisher } from '@/lib/api'
import { absoluteUrl, shareMetadata } from '@/lib/site'
import { EventList } from '@/components/EventList'
import { LinkButtons } from '@/components/LinkButtons'
import { JsonLd } from '@/components/JsonLd'
import { Headline } from '@/components/Headline'
import { TickIcon } from '@/components/Icons'

type Params = Promise<{ slug: string }>

async function load(params: Params) {
  const { slug } = await params
  const publisher = await getPublisher(slug)
  if (!publisher) notFound()
  return publisher
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await load(params)
  const n = Object.keys(p.links).length
  const description = `Event organizer${n ? ` · ${n} link${n === 1 ? '' : 's'}` : ''}`
  return {
    title: p.name,
    description,
    ...shareMetadata(`/publishers/${p.slug}`, p.name, description),
  }
}

export default async function PublisherPage({ params }: { params: Params }) {
  const p = await load(params)

  const apiQuery = new URLSearchParams({ status: ALL_STATUSES, publisher_id: p.id, limit: '20' })
  const events = await getEvents(apiQuery)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: p.name,
    url: absoluteUrl(`/publishers/${p.slug}`),
    sameAs: Object.values(p.links),
  }

  return (
    <div className="kk-container" style={{ gap: 52 }}>
      <JsonLd data={jsonLd} />

      <header className="kk-intro" style={{ gap: 16 }}>
        <p className="kk-eyebrow">Publisher</p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Headline text={p.name} />
          {p.verified && (
            <span className="kk-badge kk-badge--verified" title="Verified publisher">
              <TickIcon />
              Verified
            </span>
          )}
        </div>
        <LinkButtons links={p.links} />
      </header>

      <section>
        <h2 className="kk-section-title">Upcoming events</h2>
        <hr className="kk-rule" />
        <EventList
          initialEvents={events.data}
          initialCursor={events.meta.cursor}
          apiQuery={apiQuery.toString()}
          emptyMessage="No upcoming events from this publisher."
        />
      </section>
    </div>
  )
}
