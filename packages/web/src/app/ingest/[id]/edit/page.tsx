import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getIngestItem, getTags, isUuid } from '@/lib/api'
import { getCurrentAccount, getSessionCookieHeader } from '@/lib/session'
import { submitterLine } from '@/lib/ingest-submitter'
import { EventForm } from '@/components/EventForm'
import { Headline } from '@/components/Headline'

export const metadata: Metadata = { title: 'Edit & accept', robots: { index: false } }

type Params = Promise<{ id: string }>

/** A scout fixes an inbox item and publishes it in one go. Scouts only. */
export default async function IngestEditPage({ params }: { params: Params }) {
  const { id } = await params
  const me = await getCurrentAccount()
  const cookie = await getSessionCookieHeader()
  if (!me?.is_scout || !cookie || !isUuid(id)) notFound()
  const [item, tags] = await Promise.all([getIngestItem(id, cookie), getTags()])
  if (!item) notFound()
  // Only undecided items can be published
  if (item.state !== 'new') redirect(`/ingest/${id}`)

  return (
    <div className="kk-container kk-container--narrow">
      <section className="kk-intro" style={{ gap: 12 }}>
        <Link href="/ingest" className="self-start text-[15px] text-muted">
          ← Inbox
        </Link>
        <p className="kk-eyebrow">Scouts</p>
        <Headline text="Edit & accept" narrow />
        <p className="kk-lede max-w-none">
          {item.source.kind === 'suggestion' && item.submitter ? `${submitterLine(item.submitter)}. ` : `From ${item.source.name}. `}
          Publishing creates the event with your changes.
        </p>
      </section>
      <EventForm mode="accept" item={item} knownTags={tags} />
    </div>
  )
}
