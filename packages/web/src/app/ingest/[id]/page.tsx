import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getIngestItem, isUuid } from '@/lib/api'
import { getCurrentPublisher, getSessionCookieHeader } from '@/lib/session'
import { EventDetailBody } from '@/components/EventDetailBody'
import { IngestDecisionBar } from '@/components/IngestDecisionBar'

export const metadata: Metadata = { title: 'Inbox preview', robots: { index: false } }

type Params = Promise<{ id: string }>

/** A feed item shown as its event page would look, with the scout's decision on top. Scouts only. */
export default async function IngestItemPage({ params }: { params: Params }) {
  const { id } = await params
  const me = await getCurrentPublisher()
  const cookie = await getSessionCookieHeader()
  if (!me?.is_scout || !cookie || !isUuid(id)) notFound()
  const item = await getIngestItem(id, cookie)
  if (!item) notFound()
  const { draft } = item

  return (
    <article className="kk-container" style={{ gap: 52 }}>
      <div className="flex flex-col gap-4">
        <Link href={item.state === 'gone' ? '/ingest?view=gone' : '/ingest'} className="self-start text-[15px] text-muted">
          ← Inbox
        </Link>
        <IngestDecisionBar item={item} />
      </div>

      <EventDetailBody
        title={draft.title}
        startsAt={draft.starts_at}
        endsAt={draft.ends_at}
        status="scheduled"
        recurrence={null}
        categories={draft.categories}
        tags={[]}
        description={draft.description}
        links={draft.links}
        venue={item.venue}
        locationText={draft.location_text}
        city={draft.city}
        imageUrl={draft.image_url}
      />
    </article>
  )
}
