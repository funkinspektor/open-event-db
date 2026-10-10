import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getVenue, isUuid } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { VenueEditForm } from '@/components/VenueEditForm'

type Params = Promise<{ id: string }>

export const metadata: Metadata = { title: 'Edit venue' }

export default async function EditVenuePage({ params }: { params: Params }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const me = await getCurrentPublisher()
  if (!me) redirect('/login')

  const venue = await getVenue(id)
  if (!venue) notFound()

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">Edit venue</p>
        <h1 className="text-3xl font-semibold tracking-tight">{venue.name}</h1>
        <p className="mt-1 text-neutral-600">
          Venues are maintained by all publishers together. Changes are logged with your name.
        </p>
      </div>
      <VenueEditForm venue={venue} />
    </div>
  )
}
