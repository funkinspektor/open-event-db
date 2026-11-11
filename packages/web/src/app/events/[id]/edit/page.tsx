import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { canCancel, canEdit, actorRole, canManageOrganizers, isClaimed } from '@open-event-db/shared'
import { getEvent, getTags, isUuid } from '@/lib/api'
import { getCurrentAccount } from '@/lib/session'
import { permissionActor, permissionEvent } from '@/lib/permissions'
import { EventForm } from '@/components/EventForm'
import { CoHostsEditor } from '@/components/CoHostsEditor'
import { Headline } from '@/components/Headline'

type Params = Promise<{ id: string }>

export const metadata: Metadata = { title: 'Edit event' }

export default async function EditEventPage({ params }: { params: Params }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const me = await getCurrentAccount()
  if (!me) redirect(`/login`)

  const [event, tags] = await Promise.all([getEvent(id), getTags()])
  if (!event) notFound()

  const pEvent = permissionEvent(event)
  const actor = permissionActor(me)
  if (!canEdit(pEvent, actor)) redirect(`/events/${id}`)
  const role = actorRole(pEvent, actor)
  const editingAs = role === 'creator' ? 'creator' : role === 'co_host' ? 'co-host' : 'scout'

  return (
    <div className="kk-container kk-container--narrow">
      <section className="kk-intro" style={{ gap: 12 }}>
        <p className="kk-eyebrow">Edit event</p>
        <Headline text="Edit event" narrow />
        <p className="kk-lede max-w-none">
          Editing as {me.display_name} ({editingAs}). Changes go live as soon as you save.
          {!isClaimed(pEvent) && ' The organizer hasn’t claimed this event yet, so any scout can edit it.'}
        </p>
      </section>
      {event.synced_from && (
        <div className="kk-notice mb-[18px]" role="status">
          This event is synced from {event.synced_from.source_name}. Editing it stops the sync.
        </div>
      )}
      <EventForm mode="edit" event={event} canCancel={canCancel(pEvent, actor)} knownTags={tags} />
      {canManageOrganizers(pEvent, actor) && (
        <div className="mt-10">
          <CoHostsEditor eventId={event.id} organizers={event.organizers} />
        </div>
      )}
    </div>
  )
}
