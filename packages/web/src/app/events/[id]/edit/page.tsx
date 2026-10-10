import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getEvent, getTags, isUuid } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { EventForm } from '@/components/EventForm'
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

  const role = event.owners.find((o) => o.publisher_id === me.id)?.role
  if (!role) redirect(`/events/${id}`)

  return (
    <div className="kk-container kk-container--narrow">
      <section className="kk-intro" style={{ gap: 12 }}>
        <p className="kk-eyebrow">Edit event</p>
        <Headline text="Edit event" narrow />
        <p className="kk-lede max-w-none">
          Editing as {me.name} ({role === 'creator' ? 'creator' : 'co-host'}). Changes go live as soon as you save.
        </p>
      </section>
      <EventForm mode="edit" event={event} role={role} knownTags={tags} />
    </div>
  )
}
