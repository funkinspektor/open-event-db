import type { Metadata } from 'next'
import Link from 'next/link'
import { getVenues } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { shareMetadata } from '@/lib/site'
import { Headline } from '@/components/Headline'
import { NextIcon, SearchIcon } from '@/components/Icons'

export const metadata: Metadata = {
  title: 'Venues',
  description: 'Clubs, bars and spaces on Kellerkompass.',
  ...shareMetadata('/venues', 'Venues', 'Clubs, bars and spaces on Kellerkompass.'),
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>
type FeedFilter = 'any' | 'none' | undefined

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** The venue list URL for a search and feed filter. */
function venuesHref(q: string, feed: FeedFilter): string {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (feed) params.set('feed', feed)
  const query = params.toString()
  return query ? `/venues?${query}` : '/venues'
}

export default async function VenuesPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams
  const q = first(raw.q)?.trim() ?? ''
  const me = await getCurrentPublisher()
  // Feed coverage is a scout's concern: the filter and the feed names are shown to scouts only
  const scout = !!me?.is_scout
  const requested = first(raw.feed)
  const feed: FeedFilter = scout && (requested === 'any' || requested === 'none') ? requested : undefined

  const params = new URLSearchParams({ limit: '100' })
  if (q) params.set('q', q)
  if (feed) params.set('feed', feed)
  const { data: venues, meta } = await getVenues(params)

  const feedTabs: { feed: FeedFilter; label: string }[] = [
    { feed: undefined, label: 'All venues' },
    { feed: 'none', label: 'Without feed' },
    { feed: 'any', label: 'With feed' },
  ]

  return (
    <div className="kk-container" style={{ gap: 44 }}>
      <section className="kk-intro">
        <Headline text="Venues" />
        <p className="kk-lede">Clubs, bars and spaces with events in the database. Maintained by the community.</p>
      </section>

      <form action="/venues" className="flex max-w-[520px] gap-2">
        <label className="flex h-12 flex-auto items-center gap-2.5 rounded-pill border border-border bg-surface-1 px-4 focus-within:border-uv focus-within:shadow-focus">
          <SearchIcon />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search venues…"
            aria-label="Search venues"
            className="min-w-0 flex-1 border-0 bg-transparent text-body text-ink outline-none placeholder:text-faint"
          />
        </label>
        {feed && <input type="hidden" name="feed" value={feed} />}
        <button type="submit" className="kk-btn kk-btn--primary min-h-12">
          Search
        </button>
      </form>

      {scout && (
        <nav className="kk-pills" aria-label="Feed coverage">
          {feedTabs.map((t) => (
            <Link
              key={t.label}
              href={venuesHref(q, t.feed)}
              className="kk-pill"
              aria-current={t.feed === feed ? 'page' : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}

      <section aria-label="Venue list">
        <hr className="kk-rule" />
        {venues.length === 0 ? (
          <p className="kk-empty">
            {q
              ? `No venue matches “${q}”${feed ? ' with this filter' : ''}.`
              : feed === 'none'
                ? 'Every venue has a feed.'
                : feed === 'any'
                  ? 'No venue has a feed yet.'
                  : 'No venues yet.'}
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(420px,100%),1fr))] gap-x-8 p-0">
            {venues.map((v) => (
              <li key={v.id}>
                <Link href={`/venues/${v.id}`} className="kk-listlink">
                  <span className="min-w-0">
                    <span className="kk-listlink__name">{v.name}</span>
                    <span className="kk-listlink__meta">
                      {v.address} · {v.city}
                      {scout && ` · ${v.feeds.length ? `Feed: ${v.feeds.map((f) => f.name).join(', ')}` : 'No feed'}`}
                    </span>
                  </span>
                  <span className="kk-listlink__arrow" aria-hidden>
                    <NextIcon className="kk-icon" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {meta.has_more && (
        <p className="kk-hint m-0 text-[14px]">Showing the first 100 venues — use the search to narrow it down.</p>
      )}
    </div>
  )
}
