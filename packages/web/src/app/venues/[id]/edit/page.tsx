import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getVenue, isUuid } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { VenueEditForm } from '@/components/VenueEditForm'
import { Headline } from '@/components/Headline'

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
    <div className="kk-container kk-container--narrow">
      <section className="kk-intro" style={{ gap: 12 }}>
        <p className="kk-eyebrow">Edit venue</p>
        <Headline text={venue.name} narrow />
        <p className="kk-lede max-w-none">
          Venues are maintained by all publishers together. Changes are logged with your name.
        </p>
      </section>
      <VenueEditForm venue={venue} />
    </div>
  )
}
