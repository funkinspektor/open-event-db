import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ALL_STATUSES, getEvents, getPublisher } from '@/lib/api'
import { EventList } from '@/components/EventList'
import { LinkButtons } from '@/components/LinkButtons'
import { JsonLd } from '@/components/JsonLd'

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
    openGraph: { title: p.name, description, type: 'website' },
    twitter: { card: 'summary', title: p.name, description },
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
    url: `/publishers/${p.slug}`,
    sameAs: Object.values(p.links),
  }

  return (
    <div className="space-y-8">
      <JsonLd data={jsonLd} />

      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">Publisher</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{p.name}</h1>
          {p.verified && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20"
              title="Verified publisher"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
                <path
                  fillRule="evenodd"
                  d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                  clipRule="evenodd"
                />
              </svg>
              Verified
            </span>
          )}
        </div>
        <LinkButtons links={p.links} />
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Upcoming events</h2>
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
