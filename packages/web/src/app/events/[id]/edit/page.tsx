import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { canCancel, canEdit, canManageOwners, isClaimed, ownerRole } from '@open-event-db/shared'
import { getEvent, getTags, isUuid } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { EventForm } from '@/components/EventForm'
import { CoOwnersEditor } from '@/components/CoOwnersEditor'
import { Headline } from '@/components/Headline'

type Params = Promise<{ id: string }>

export const metadata: Metadata = { title: 'Edit event' }

export default async function EditEventPage({ params }: { params: Params }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const me = await getCurrentPublisher()
  if (!me) redirect(`/login`)

  const [event, tags] = await Promise.all([getEvent(id), getTags()])
  if (!event) notFound()

  if (!canEdit(event, me)) redirect(`/events/${id}`)
  const role = ownerRole(event, me)
  const editingAs = role === 'creator' ? 'creator' : role === 'co_owner' ? 'co-host' : 'scout'

  return (
    <div className="kk-container kk-container--narrow">
      <section className="kk-intro" style={{ gap: 12 }}>
        <p className="kk-eyebrow">Edit event</p>
        <Headline text="Edit event" narrow />
        <p className="kk-lede max-w-none">
          Editing as {me.name} ({editingAs}). Changes go live as soon as you save.
          {!isClaimed(event) && ' The organizer hasn’t claimed this event yet, so any scout can edit it.'}
        </p>
      </section>
      {event.synced_from && (
        <div className="kk-notice mb-[18px]" role="status">
          This event is synced from {event.synced_from.source_name}. Editing it stops the sync.
        </div>
      )}
      <EventForm mode="edit" event={event} canCancel={canCancel(event, me)} knownTags={tags} />
      {canManageOwners(event, me) && (
        <div className="mt-10">
          <CoOwnersEditor eventId={event.id} owners={event.owners} />
        </div>
      )}
    </div>
  )
}
