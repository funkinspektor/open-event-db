import type { Metadata } from 'next'
import { getEvents, getTags } from '@/lib/api'
import { buildApiQuery, parseFilters } from '@/lib/filters'
import { Filters } from '@/components/Filters'
import { MobileFilters } from '@/components/MobileFilters'
import { EventList } from '@/components/EventList'
import { Headline } from '@/components/Headline'
import { shareMetadata } from '@/lib/site'

export const metadata: Metadata = {
  title: { absolute: 'Kellerkompass — Events in Berlin' },
  description: 'Discover events in Berlin.',
  ...shareMetadata('/', 'Kellerkompass — Events in Berlin', 'Discover events in Berlin'),
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

      {/* Desktop filter bar; phones get the toolbar under the rule instead */}
      <div className="kk-desktop-only">
        <Filters filters={filters} allTags={tags} />
      </div>

      <section aria-label="Event list">
        <hr className="kk-rule" />
        <MobileFilters filters={filters} allTags={tags} />
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
