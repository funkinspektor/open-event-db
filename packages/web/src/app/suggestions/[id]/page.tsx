import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSuggestionPreview, isUuid } from '@/lib/api'
import { getCurrentAccount, getSessionCookieHeader } from '@/lib/session'
import { EventDetailBody } from '@/components/EventDetailBody'
import { SuggestionNotice } from '@/components/SuggestionNotice'

type Params = Promise<{ id: string }>

// Private to its owner, never listed or shared
export const metadata: Metadata = { title: 'Your suggestion', robots: { index: false } }

/**
 * A person's own suggestion the way it would look as an event. Same body as the event page, without what only
 * a real event has: interest star, Edit, report link, sharing and structured data.
 */
export default async function SuggestionPage({ params }: { params: Params }) {
  const { id } = await params
  const me = await getCurrentAccount()
  const cookie = await getSessionCookieHeader()
  if (!me || !cookie) redirect('/login?return_to=' + encodeURIComponent(`/suggestions/${id}`))
  if (!isUuid(id)) notFound()

  const found = await getSuggestionPreview(id, cookie)
  if (!found) notFound()
  const { suggestion, preview: e } = found
  if (suggestion.status === 'live' && suggestion.event_id) redirect(`/events/${suggestion.event_id}`)

  return (
    <article className="kk-container">
      <SuggestionNotice suggestion={suggestion} />
      <EventDetailBody
        title={e.title}
        startsAt={e.starts_at}
        startTimeKnown={e.start_time_known}
        endsAt={e.ends_at}
        status={e.status}
        recurrence={e.recurrence}
        categories={e.categories}
        tags={e.tags}
        description={e.description}
        lineup={e.lineup}
        links={e.links}
        venue={e.venue}
        locationText={e.location_text}
        city={e.city}
        imageUrl={e.image_url}
        back={{ href: '/dashboard', label: 'Dashboard' }}
      />
    </article>
  )
}
