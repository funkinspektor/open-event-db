import type { Metadata } from 'next'
import { getEvents, getTags } from '@/lib/api'
import { buildApiQuery, parseFilters } from '@/lib/filters'
import { Filters } from '@/components/Filters'
import { EventList } from '@/components/EventList'
import { Headline } from '@/components/Headline'

export const metadata: Metadata = {
  title: { absolute: 'Kellerkompass — Events in Berlin' },
  description: 'Discover events in Berlin.',
  openGraph: { title: 'Kellerkompass — Events in Berlin', description: 'Discover events in Berlin' },
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(await searchParams)
  const apiQuery = buildApiQuery(filters)
  const [events, tags] = await Promise.all([getEvents(apiQuery), getTags()])

  return (
    <div className="kk-container">
      <section className="kk-intro">
        <Headline text={`Events in ${filters.city}`} chrome={filters.city} />
        <p className="kk-lede">A community-owned database of events. Open data, open API, no algorithm.</p>
      </section>

      <Filters filters={filters} allTags={tags} />

      <section aria-label="Event list">
        <hr className="kk-rule" />
        <EventList
          key={apiQuery.toString()}
          initialEvents={events.data}
          initialCursor={events.meta.cursor}
          apiQuery={apiQuery.toString()}
          groupByDay
        />
      </section>
    </div>
  )
}
