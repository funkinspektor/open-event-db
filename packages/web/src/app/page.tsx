import type { Metadata } from 'next'
import { getEvents, getInterestIds, getTags } from '@/lib/api'
import { getCurrentAccount, getSessionCookieHeader } from '@/lib/session'
import { canCreateEvents, canSuggestEvents } from '@/lib/permissions'
import { CalendarPanel } from '@/components/CalendarPanel'
import { buildApiQuery, filtersToHref, parseFilters } from '@/lib/filters'
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

const PAST_DAYS = 90

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const [parsed, me, cookie] = await Promise.all([
    searchParams.then(parseFilters),
    getCurrentAccount(),
    getSessionCookieHeader(),
  ])
  // "Only mine" needs a session; without one the parameter is ignored.
  const loggedIn = !!me && !!cookie
  const filters = { ...parsed, mine: parsed.mine && loggedIn ? true : undefined }
  const apiQuery = buildApiQuery(filters)
  // The list's first day: the range's start, or today. Events that started earlier show as Ongoing.
  const firstDay = dayKey(apiQuery.get('from') ?? new Date().toISOString())

  // Past marked events, collapsed under the list: the last 90 days, newest first.
  const now = new Date()
  const pastQuery = new URLSearchParams(apiQuery)
  pastQuery.set('from', new Date(now.getTime() - PAST_DAYS * 24 * 60 * 60 * 1000).toISOString())
  // Never reaches into the main list: it ends where the main list starts (or now, if that is later).
  const mainFrom = apiQuery.get('from')
  pastQuery.set('to', mainFrom && mainFrom < now.toISOString() ? mainFrom : now.toISOString())
  pastQuery.set('order', 'desc')

  const [events, tags, past, interestedIds] = await Promise.all([
    getEvents(apiQuery, filters.mine ? (cookie ?? undefined) : undefined),
    getTags(),
    // Skipped when the main list starts further back than the Past window: nothing is left for it.
    filters.mine && pastQuery.get('from')! < pastQuery.get('to')! ? getEvents(pastQuery, cookie ?? undefined) : null,
    // Anonymous visitors cost no extra call; in "Only mine" every row is marked anyway.
    loggedIn && cookie && !filters.mine
      ? getInterestIds(
          cookie,
          // No lower bound: ongoing events started before the list's `from` and still need their star.
          undefined,
          apiQuery.get('to') ? new Date(apiQuery.get('to')!) : undefined,
        )
      : null,
  ])

  return (
    <div className="kk-container">
      <section className="kk-intro">
        <Headline text={`Events in ${filters.city}`} chrome={filters.city} />
        <p className="kk-lede">A community-owned database of events. Open data, open API, no algorithm.</p>
      </section>

      <section aria-label="Event list">
        <hr className="kk-rule" />
        <ListToolbar filters={filters} allTags={tags} loggedIn={loggedIn} entry={!me ? 'suggest-login' : canCreateEvents(me) ? 'create' : canSuggestEvents(me) ? 'suggest' : null} />
        {filters.mine && <CalendarPanel />}
        {filters.q && (
          <SearchInfo filters={{ ...filters, q: filters.q }} count={events.data.length} more={events.meta.has_more} />
        )}
        <EventList
          key={apiQuery.toString()}
          initialEvents={events.data}
          initialCursor={events.meta.cursor}
          apiQuery={apiQuery.toString()}
          groupByDay={firstDay}
          emptyMessage={
            filters.q
              ? 'Nothing coming up. Try another spelling, or a shorter part of the name.'
              : filters.mine
                ? 'Nothing saved yet. Tap ☆ on an event to keep it here and in your calendar.'
                : undefined
          }
          interestedIds={interestedIds ? [...interestedIds] : loggedIn ? [] : null}
          allInterested={filters.mine}
        />
        {past && past.data.length > 0 && (
          <details className="kk-past">
            <summary>Past</summary>
            <EventList
              key={`past${filtersToHref(filters)}`}
              initialEvents={past.data}
              initialCursor={past.meta.cursor}
              apiQuery={pastQuery.toString()}
              interestedIds={[]}
              allInterested
            />
          </details>
        )}
      </section>
    </div>
  )
}
