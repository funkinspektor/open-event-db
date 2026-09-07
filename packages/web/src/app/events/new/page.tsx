import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTags, getVenues } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { EventForm } from '@/components/EventForm'

export const metadata: Metadata = { title: 'Create event' }

export default async function NewEventPage() {
  const me = await getCurrentPublisher()
  if (!me) redirect('/login')

  const [venues, tags] = await Promise.all([getVenues(), getTags()])

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">New event</p>
        <h1 className="text-3xl font-semibold tracking-tight">Create event</h1>
        <p className="mt-1 text-neutral-600">Published as {me.name}. Live on the listing as soon as you save.</p>
      </div>
      <EventForm mode="create" venues={venues} knownTags={tags} />
    </div>
  )
}
