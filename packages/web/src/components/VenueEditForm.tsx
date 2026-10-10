'use client'

import { useRouter } from 'next/navigation'
import type { Venue } from '@open-event-db/shared'
import { VenueForm } from './VenueForm'

export function VenueEditForm({ venue }: { venue: Venue }) {
  const router = useRouter()
  return (
    <VenueForm
      venue={venue}
      onCancel={() => router.push(`/venues/${venue.id}`)}
      onSaved={() => {
        router.push(`/venues/${venue.id}`)
        router.refresh()
      }}
    />
  )
}
