import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { canEdit } from '@open-event-db/shared'
import { getEvent, getIngestItem, isUuid } from '@/lib/api'
import { getCurrentPublisher, getSessionCookieHeader } from '@/lib/session'
import { EventDetailBody } from '@/components/EventDetailBody'
import { IngestDecisionBar } from '@/components/IngestDecisionBar'
import { IngestMergePanel } from '@/components/IngestMergePanel'

export const metadata: Metadata = { title: 'Inbox preview', robots: { index: false } }

type Params = Promise<{ id: string }>
type SearchParams = Promise<{ merge?: string }>

/**
 * A feed item shown as its event page would look, with the scout's decision on top. Scouts only.
 * `?merge=<event id>` compares it with that event instead, to link the two.
 */
export default async function IngestItemPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params
  const { merge } = await searchParams
  const me = await getCurrentPublisher()
  const cookie = await getSessionCookieHeader()
  if (!me?.is_scout || !cookie || !isUuid(id)) notFound()
  const item = await getIngestItem(id, cookie)
  if (!item) notFound()
  const { draft } = item
  const target = item.state === 'new' && merge && isUuid(merge) ? await getEvent(merge) : null

  return (
    <article className="kk-container" style={{ gap: 52 }}>
      <div className="flex flex-col gap-4">
        <Link href={item.state === 'gone' ? '/ingest?view=gone' : '/ingest'} className="self-start text-[15px] text-muted">
          ← Inbox
        </Link>
        {target ? (
          <IngestMergePanel item={item} event={target} editable={canEdit(target, { id: me.id, is_scout: me.is_scout })} />
        ) : (
          <IngestDecisionBar item={item} />
        )}
      </div>

      {!target && (
        <EventDetailBody
          title={draft.title}
          startsAt={draft.starts_at}
          endsAt={draft.ends_at}
          status="scheduled"
          recurrence={null}
          categories={draft.categories}
          tags={[]}
          description={draft.description}
          lineup={draft.lineup}
          links={draft.links}
          venue={item.venue}
          locationText={draft.location_text}
          city={draft.city}
          imageUrl={draft.image_url}
        />
      )}
    </article>
  )
}
