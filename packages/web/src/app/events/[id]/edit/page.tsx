import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getEvent, getTags, getVenues, isUuid } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { EventForm } from '@/components/EventForm'

type Params = Promise<{ id: string }>

export const metadata: Metadata = { title: 'Edit event' }

export default async function EditEventPage({ params }: { params: Params }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const me = await getCurrentPublisher()
  if (!me) redirect(`/login`)

  const [event, venues, tags] = await Promise.all([getEvent(id), getVenues(), getTags()])
  if (!event) notFound()

  const role = event.owners.find((o) => o.publisher_id === me.id)?.role
  if (!role) redirect(`/events/${id}`)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">Edit event</p>
        <h1 className="text-3xl font-semibold tracking-tight">{event.title}</h1>
        <p className="mt-1 text-neutral-600">
          You are editing as {me.name} ({role === 'creator' ? 'creator' : 'co-host'}).
        </p>
      </div>
      <EventForm mode="edit" event={event} venues={venues} role={role} knownTags={tags} />
    </div>
  )
}
