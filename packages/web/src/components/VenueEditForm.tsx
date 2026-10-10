'use client'

import { useRouter } from 'next/navigation'
import type { Venue } from '@open-event-db/shared'
import { VenueForm } from './VenueForm'

const input =
  'mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 disabled:bg-neutral-50 disabled:text-neutral-500'

export function VenueEditForm({ venue }: { venue: Venue }) {
  const router = useRouter()
  return (
    <VenueForm
      venue={venue}
      inputClassName={input}
      onCancel={() => router.push(`/venues/${venue.id}`)}
      onSaved={() => {
        router.push(`/venues/${venue.id}`)
        router.refresh()
      }}
    />
  )
}
