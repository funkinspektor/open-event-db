import type { Metadata } from 'next'
import { getEvents, getTags } from '@/lib/api'
import { buildApiQuery, parseFilters } from '@/lib/filters'
import { Filters } from '@/components/Filters'
import { EventList } from '@/components/EventList'

export const metadata: Metadata = {
  title: 'Open Event Database — Events in Berlin',
  description: 'Discover events in Berlin.',
  openGraph: { title: 'Open Event Database — Events in Berlin', description: 'Discover events in Berlin' },
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(await searchParams)
  const apiQuery = buildApiQuery(filters)
  const [events, tags] = await Promise.all([getEvents(apiQuery), getTags()])

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Events in {filters.city}</h1>
        <p className="max-w-prose text-neutral-600">
          A community-owned database of events. Open data, open API, no algorithm.
        </p>
      </section>

      <Filters filters={filters} allTags={tags} />

      <section aria-label="Event list">
        <EventList
          key={apiQuery.toString()}
          initialEvents={events.data}
          initialCursor={events.meta.cursor}
          apiQuery={apiQuery.toString()}
        />
      </section>
    </div>
  )
}
