import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { IngestView } from '@open-event-db/shared'
import { getIngestAccuracy, getIngestItems } from '@/lib/api'
import { getCurrentPublisher, getSessionCookieHeader } from '@/lib/session'
import { Headline } from '@/components/Headline'
import { IngestAccuracy } from '@/components/IngestAccuracy'
import { IngestInbox } from '@/components/IngestInbox'
import { IngestSourceFilter } from '@/components/IngestSourceFilter'
import { NextIcon } from '@/components/Icons'

export const metadata: Metadata = { title: 'Inbox' }

const PAGE_SIZE = 50

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined

/** The inbox URL for a view, source and page; the first page of the new view is plain /ingest. */
function inboxHref(view: IngestView, source?: string, cursor?: string): string {
  const params = new URLSearchParams()
  if (view !== 'new') params.set('view', view)
  if (source) params.set('source', source)
  if (cursor) params.set('cursor', cursor)
  const query = params.toString()
  return query ? `/ingest?${query}` : '/ingest'
}

export default async function IngestPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await getCurrentPublisher()
  const cookie = await getSessionCookieHeader()
  if (!me?.is_scout || !cookie) notFound()

  const params = await searchParams
  const requested = first(params.view)
  const view: IngestView = requested === 'filtered' || requested === 'gone' ? requested : 'new'
  const source = first(params.source)
  const cursor = first(params.cursor)
  const [{ data, meta }, accuracy] = await Promise.all([
    getIngestItems({ view, source, cursor, limit: PAGE_SIZE }, cookie),
    getIngestAccuracy(cookie).catch(() => []), // the accuracy block is a nicety: it must not take the inbox down
  ])

  const tabs: { view: IngestView; label: string }[] = [
    { view: 'new', label: 'New' },
    { view: 'filtered', label: 'Filtered out' },
    { view: 'gone', label: 'Gone from source' },
  ]
  const total = meta.sources.reduce((sum, s) => sum + s.count, 0)
  const sourceHrefs = Object.fromEntries(meta.sources.map((s) => [s.slug, inboxHref(view, s.slug)]))

  return (
    <div className="kk-container">
      <section className="kk-intro" style={{ gap: 12 }}>
        <p className="kk-eyebrow">Scouts</p>
        <Headline text="Inbox" style={{ fontSize: 'clamp(64px, 9vw, 120px)' }} />
      </section>

      <nav className="kk-pills" aria-label="Inbox views">
        {tabs.map((t) => (
          <Link
            key={t.view}
            href={inboxHref(t.view, source)}
            className="kk-pill"
            aria-current={t.view === view ? 'page' : undefined}
          >
            {t.label}
            {meta.counts[t.view] > 0 && <span className="kk-pill__count">{meta.counts[t.view]}</span>}
          </Link>
        ))}
      </nav>

      {(meta.sources.length > 1 || source) && (
        <IngestSourceFilter
          sources={meta.sources}
          value={source}
          total={total}
          hrefs={sourceHrefs}
          allHref={inboxHref(view)}
        />
      )}

      <IngestInbox items={data} view={view} />

      {(cursor || meta.has_more) && (
        <nav className="flex flex-wrap items-center justify-between gap-4" aria-label="Inbox pages">
          {cursor ? (
            <Link href={inboxHref(view, source)} className="kk-btn kk-btn--outline">
              First page
            </Link>
          ) : (
            <span className="kk-hint">
              The first {data.length} of {meta.counts[view]}
            </span>
          )}
          {meta.has_more && meta.cursor && (
            <Link href={inboxHref(view, source, meta.cursor)} className="kk-btn kk-btn--outline">
              Next {PAGE_SIZE}
              <NextIcon />
            </Link>
          )}
        </nav>
      )}

      <IngestAccuracy rows={accuracy} />
    </div>
  )
}
