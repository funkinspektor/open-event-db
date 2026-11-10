import type { Metadata } from 'next'
import { getEvents, getTags } from '@/lib/api'
import { buildApiQuery, parseFilters } from '@/lib/filters'
import { ListToolbar } from '@/components/ListToolbar'
import { SearchInfo } from '@/components/SearchInfo'
import { EventList } from '@/components/EventList'
import { Headline } from '@/components/Headline'
import { shareMetadata } from '@/lib/site'
import { dayKey } from '@/lib/format'

export const metadata: Metadata = {
  title: { absolute: 'Kellerkompass — Events in Berlin' },
  description: 'Discover events in Berlin.',
  ...shareMetadata('/', 'Kellerkompass — Events in Berlin', 'Discover events in Berlin'),
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(await searchParams)
  const apiQuery = buildApiQuery(filters)
  // The list's first day: the range's start, or today. Events that started earlier show as Ongoing.
  const firstDay = dayKey(apiQuery.get('from') ?? new Date().toISOString())
  const [events, tags] = await Promise.all([getEvents(apiQuery), getTags()])

  return (
    <div className="kk-container">
      <section className="kk-intro">
        <Headline text={`Events in ${filters.city}`} chrome={filters.city} />
        <p className="kk-lede">A community-owned database of events. Open data, open API, no algorithm.</p>
      </section>

      <section aria-label="Event list">
        <hr className="kk-rule" />
        <ListToolbar filters={filters} allTags={tags} />
        {filters.q && (
          <SearchInfo filters={{ ...filters, q: filters.q }} count={events.data.length} more={events.meta.has_more} />
        )}
        <EventList
          key={apiQuery.toString()}
          initialEvents={events.data}
          initialCursor={events.meta.cursor}
          apiQuery={apiQuery.toString()}
          groupByDay={firstDay}
          emptyMessage={filters.q ? 'Nothing coming up. Try another spelling, or a shorter part of the name.' : undefined}
        />
      </section>
    </div>
  )
}
