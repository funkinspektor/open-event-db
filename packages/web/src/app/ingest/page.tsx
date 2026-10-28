import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getIngestItems, type IngestView } from '@/lib/api'
import { getCurrentPublisher, getSessionCookieHeader } from '@/lib/session'
import { Headline } from '@/components/Headline'
import { IngestInbox } from '@/components/IngestInbox'

export const metadata: Metadata = { title: 'Inbox' }

type SearchParams = Promise<{ view?: string }>

export default async function IngestPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await getCurrentPublisher()
  const cookie = await getSessionCookieHeader()
  if (!me?.is_scout || !cookie) notFound()

  const { view: raw } = await searchParams
  const view: IngestView = raw === 'gone' ? 'gone' : 'new'
  const { data, meta } = await getIngestItems(view, cookie)

  const tabs: { view: IngestView; label: string; href: string }[] = [
    { view: 'new', label: 'New', href: '/ingest' },
    { view: 'gone', label: 'Gone from source', href: '/ingest?view=gone' },
  ]

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
            href={t.href}
            className="kk-pill"
            aria-current={t.view === view ? 'page' : undefined}
          >
            {t.label}
            {meta.counts[t.view] > 0 && <span className="kk-pill__count">{meta.counts[t.view]}</span>}
          </Link>
        ))}
      </nav>

      <IngestInbox items={data} view={view} />
    </div>
  )
}
