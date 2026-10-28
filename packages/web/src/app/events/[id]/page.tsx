import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { canEdit as canEditEvent } from '@open-event-db/shared'
import { getEvent, isUuid } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { absoluteUrl, shareMetadata } from '@/lib/site'
import { formatDateTime } from '@/lib/format'
import { markdownToPlainText } from '@/lib/plaintext'
import { EventDetailBody } from '@/components/EventDetailBody'
import { JsonLd } from '@/components/JsonLd'
import { Toast } from '@/components/Toast'
import { CONTACT_EMAIL } from '@/content/legal/operator'

type Params = Promise<{ id: string }>
type SearchParams = Promise<{ saved?: string }>

const SAVED_MESSAGES: Record<string, string> = {
  created: 'Event created — it’s live now.',
  updated: 'Changes saved.',
  created_image_failed: 'Event created, but the image couldn’t be saved. Edit the event to try again.',
  updated_image_failed: 'Changes saved, but the image couldn’t be saved. Try again.',
  accepted: 'Accepted — it’s live now.',
}

async function load(params: Params) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const event = await getEvent(id)
  if (!event) notFound()
  return event
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const e = await load(params)
  const where = e.venue?.name ?? e.location_text ?? e.city
  const description = `${formatDateTime(e.starts_at, e.ends_at)} · ${where} · ${e.city}`
  return {
    title: e.title,
    description,
    ...shareMetadata(`/events/${e.id}`, e.title, description, e.image_url),
  }
}

function reportHref(title: string, url: string) {
  const body = [
    `Event: ${url}`,
    '',
    'Why is this content illegal or against the terms of use?',
    '',
    '',
    'Your name:',
    '',
    'I confirm that the information in this notice is accurate and complete to the best of my knowledge.',
  ].join('\n')
  const params = `subject=${encodeURIComponent(`Report event: ${title}`)}&body=${encodeURIComponent(body)}`
  return `mailto:${CONTACT_EMAIL}?${params}`
}

const SCHEMA_STATUS = {
  scheduled: 'https://schema.org/EventScheduled',
  postponed: 'https://schema.org/EventPostponed',
  cancelled: 'https://schema.org/EventCancelled',
} as const

export default async function EventPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [e, me, { saved }] = await Promise.all([load(params), getCurrentPublisher(), searchParams])
  const savedMessage = saved ? SAVED_MESSAGES[saved] : undefined
  const canEdit = !!me && canEditEvent(e, me)
  // Show who added a claimed event only when it wasn't one of its owners (i.e. a scout)
  const addedByOther = e.claimed && !e.owners.some((o) => o.publisher_id === e.added_by.id)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    url: absoluteUrl(`/events/${e.id}`),
    description: e.description ? markdownToPlainText(e.description) : undefined,
    ...(e.image_url ? { image: [e.image_url] } : {}),
    startDate: e.starts_at,
    ...(e.ends_at ? { endDate: e.ends_at } : {}),
    eventStatus: SCHEMA_STATUS[e.status],
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: e.venue
      ? {
          '@type': 'Place',
          name: e.venue.name,
          address: `${e.venue.address}, ${e.venue.city}`,
          ...(e.venue.coordinates
            ? {
                geo: {
                  '@type': 'GeoCoordinates',
                  latitude: e.venue.coordinates.lat,
                  longitude: e.venue.coordinates.lng,
                },
              }
            : {}),
        }
      : { '@type': 'Place', name: e.location_text ?? e.city, address: e.city },
    // Unclaimed events have no confirmed organizer — the scout who added them isn't one
    ...(e.claimed
      ? {
          organizer: e.owners.map((o) => ({
            '@type': 'Organization',
            name: o.name,
            url: absoluteUrl(`/publishers/${o.slug}`),
          })),
        }
      : {}),
  }

  return (
    <article className="kk-container" style={{ gap: 52 }}>
      <JsonLd data={jsonLd} />
      {savedMessage && canEdit && <Toast message={savedMessage} param="saved" />}

      <EventDetailBody
        title={e.title}
        startsAt={e.starts_at}
        endsAt={e.ends_at}
        status={e.status}
        recurrence={e.recurrence}
        tags={e.tags}
        description={e.description}
        links={e.links}
        venue={e.venue}
        locationText={e.location_text}
        city={e.city}
        imageUrl={e.image_url}
        headerAction={
          canEdit && (
            <Link href={`/events/${e.id}/edit`} className="kk-btn kk-btn--outline">
              Edit event
            </Link>
          )
        }
      >
        {e.claimed ? (
          <section className="flex flex-col gap-3.5">
            <h2 className="kk-eyebrow">Organised by</h2>
            <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-[17px]">
              {e.owners.map((o) => (
                <li key={o.publisher_id}>
                  <Link href={`/publishers/${o.slug}`} className="font-bold">
                    {o.name}
                  </Link>
                  {o.role === 'co_owner' && <span className="text-muted"> (co-host)</span>}
                </li>
              ))}
            </ul>
            {addedByOther && (
              <p className="m-0 text-[14px] text-muted">
                Added by {e.added_by.name}
                {e.added_by.is_scout && ' · Scout'}
              </p>
            )}
          </section>
        ) : (
          <section className="flex flex-col gap-3.5">
            <h2 className="kk-eyebrow">Added by</h2>
            <p className="m-0 text-[17px]">
              <span className="font-bold">{e.added_by.name}</span>
              {e.added_by.is_scout && <span className="text-muted"> · Scout</span>}
            </p>
            <p className="m-0 text-[14px] text-muted">Not yet confirmed by the organizer</p>
          </section>
        )}

        {/* Notice mechanism (Art. 16 DSA): the prefilled body asks for what a valid notice needs */}
        <a href={reportHref(e.title, absoluteUrl(`/events/${e.id}`))} className="self-start text-[14px] text-muted underline underline-offset-4">
          Report event
        </a>
      </EventDetailBody>
    </article>
  )
}
