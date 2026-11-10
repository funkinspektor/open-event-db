import Link from 'next/link'
import type { EventSlim } from '@open-event-db/shared'
import { getEvents } from '@/lib/api'
import { CATEGORY_LABELS } from '@/lib/categories'
import { dayKey } from '@/lib/format'
import { buildApiQuery, filtersToHref, rangeLabel, type Filters } from '@/lib/filters'

const PAST_LIMIT = 20

/** The filters that narrow a search, as short labels: "This weekend", "Party", "techno". */
export function filterLabels(f: Filters): string[] {
  return [...(f.range === 'upcoming' ? [] : [rangeLabel(f)]), ...f.categories.map((c) => CATEGORY_LABELS[c]), ...f.tags]
}

/** Past events matching the search and the category/tag filters, newest first. */
async function findPast(f: Filters): Promise<{ events: EventSlim[]; more: boolean }> {
  const qs = buildApiQuery({ ...f, range: 'upcoming', from: undefined, to: undefined }, PAST_LIMIT)
  qs.set('to', new Date().toISOString())
  qs.set('order', 'desc')
  const res = await getEvents(qs)
  return { events: res.data, more: res.meta.has_more }
}

/**
 * The line above a search result: how many events match, which filters still narrow the search (on phones
 * the filter button is hidden while searching), and with no result, how many past events would match.
 */
export async function SearchInfo({ filters, count, more }: { filters: Filters & { q: string }; count: number; more: boolean }) {
  const labels = filterLabels(filters)
  const past = count === 0 ? await findPast(filters) : null
  const oldest = past?.events.at(-1)
  const pastHref =
    oldest &&
    filtersToHref({ ...filters, range: 'custom', from: dayKey(oldest.starts_at), to: dayKey(new Date().toISOString()) })
  const pastCount = past ? `${past.events.length}${past.more ? '+' : ''}` : ''

  return (
    <div className="kk-searchinfo" role="status">
      <p>
        {count === 0 ? 'No' : more ? `${count}+` : count} {count === 1 ? 'event' : 'events'} for{' '}
        <strong>“{filters.q}”</strong>
        {labels.length > 0 && (
          <>
            {' '}
            in <span className="kk-searchinfo__filters">{labels.join(' · ')}</span>
          </>
        )}
      </p>
      <p className="kk-searchinfo__actions">
        {labels.length > 0 && (
          <Link
            href={filtersToHref({ ...filters, range: 'upcoming', from: undefined, to: undefined, categories: [], tags: [] })}
            scroll={false}
          >
            Search without filters
          </Link>
        )}
        <Link href={filtersToHref({ ...filters, q: undefined })} scroll={false}>
          Clear search
        </Link>
      </p>
      {pastHref && (
        <p className="kk-searchinfo__past">
          {pastCount} past {pastCount === '1' ? 'event matches' : 'events match'}.{' '}
          <Link href={pastHref} scroll={false}>
            Show {pastCount === '1' ? 'it' : 'them'}
          </Link>
        </p>
      )}
    </div>
  )
}
