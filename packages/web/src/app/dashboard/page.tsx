import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { EventSlim } from '@open-event-db/shared'
import { ALL_STATUSES, getEvents } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { formatDate } from '@/lib/format'
import { EventCard } from '@/components/EventCard'

export const metadata: Metadata = { title: 'Dashboard' }

function partition(events: EventSlim[], now = new Date()) {
  const happening: EventSlim[] = []
  const upcoming: EventSlim[] = []
  const past: EventSlim[] = []
  const today = formatDate(now.toISOString())
  for (const e of events) {
    const starts = new Date(e.starts_at)
    if (starts > now) {
      upcoming.push(e)
    } else {
      const active = e.ends_at ? new Date(e.ends_at) > now : formatDate(e.starts_at) === today
      ;(active ? happening : past).push(e)
    }
  }
  past.reverse()
  return { happening, upcoming, past }
}

const editLink = (id: string) => (
  <Link
    href={`/events/${id}/edit`}
    className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
  >
    Edit
  </Link>
)

export default async function DashboardPage() {
  const me = await getCurrentPublisher()
  if (!me) redirect('/login')

  const qs = new URLSearchParams({
    publisher_id: me.id,
    status: ALL_STATUSES,
    from: '2000-01-01T00:00:00Z',
    limit: '100',
  })
  const { data } = await getEvents(qs)
  const { happening, upcoming, past } = partition(data)

  return (
    <div className="space-y-10">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">Dashboard</p>
          <h1 className="text-3xl font-semibold tracking-tight">{me.name}</h1>
          <p className="mt-1 text-neutral-600">
            <Link href={`/publishers/${me.slug}`} className="underline-offset-2 hover:underline">
              View public profile
            </Link>
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/events/new"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Create event
          </Link>
          <button
            type="button"
            disabled
            title="Coming soon"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-400"
          >
            Invite someone
          </button>
        </div>
      </section>

      {data.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center">
          <p className="text-lg font-medium">You’re in. Create your first event.</p>
          <p className="mt-1 text-sm text-neutral-500">It will be live on the public listing immediately.</p>
          <Link
            href="/events/new"
            className="mt-4 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Create event
          </Link>
        </div>
      )}

      {happening.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Happening now</h2>
          {happening.map((e) => (
            <EventCard key={e.id} event={e} happeningNow action={editLink(e.id)} />
          ))}
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Upcoming events</h2>
          {upcoming.map((e) => (
            <EventCard key={e.id} event={e} action={editLink(e.id)} />
          ))}
        </section>
      )}

      {past.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-lg font-semibold text-neutral-600 hover:text-neutral-900">
            Past events <span className="text-sm font-normal text-neutral-400">({past.length})</span>
          </summary>
          <div className="mt-3 space-y-3">
            {past.map((e) => (
              <EventCard key={e.id} event={e} action={editLink(e.id)} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
