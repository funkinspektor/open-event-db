import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { EventSlim } from '@open-event-db/shared'
import { ALL_STATUSES, getEvents } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { isHappeningNow } from '@/lib/format'
import { EventRow } from '@/components/EventRow'
import { Headline } from '@/components/Headline'
import { NextIcon } from '@/components/Icons'

export const metadata: Metadata = { title: 'Dashboard' }

function partition(events: EventSlim[], now = new Date()) {
  const happening: EventSlim[] = []
  const upcoming: EventSlim[] = []
  const past: EventSlim[] = []
  for (const e of events) {
    if (new Date(e.starts_at) > now) upcoming.push(e)
    else (isHappeningNow(e, now) ? happening : past).push(e)
  }
  past.reverse()
  return { happening, upcoming, past }
}

const editLink = (id: string) => (
  <Link href={`/events/${id}/edit`} className="kk-btn kk-btn--outline">
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
  const now = new Date()
  const { happening, upcoming, past } = partition(data, now)

  const row = (e: EventSlim) => (
    <EventRow key={e.id} event={e} showDate action={editLink(e.id)} titleSize={22} now={now} />
  )

  return (
    <div className="kk-container" style={{ gap: 56 }}>
      <section className="flex flex-wrap items-end justify-between gap-5">
        <div className="kk-intro" style={{ gap: 12 }}>
          <p className="kk-eyebrow">Dashboard</p>
          <Headline text={me.name} style={{ fontSize: 'clamp(64px, 9vw, 120px)' }} />
          <Link href={`/publishers/${me.slug}`} className="text-body text-muted">
            View public profile
            <NextIcon />
          </Link>
        </div>
        <Link href="/events/new" className="kk-btn kk-btn--primary kk-btn--lg">
          + Create event
        </Link>
      </section>

      {data.length === 0 && (
        <section>
          <h2 className="kk-section-title">You’re in. Create your first event.</h2>
          <hr className="kk-rule" />
          <p className="kk-empty">It will be live on the public listing as soon as you save it.</p>
        </section>
      )}

      {happening.length > 0 && (
        <section>
          <h2 className="kk-section-title">
            <span className="kk-live-dot" aria-hidden />
            Happening now
          </h2>
          <hr className="kk-rule kk-rule--live" />
          {happening.map(row)}
        </section>
      )}

      {upcoming.length > 0 && (
        <section>
          <h2 className="kk-section-title">Upcoming events</h2>
          <hr className="kk-rule" />
          {upcoming.map(row)}
        </section>
      )}

      {past.length > 0 && (
        <details className="kk-disclosure">
          <summary>
            <span className="kk-section-title">Past events</span>
            <span className="kk-disclosure__count">({past.length})</span>
          </summary>
          <div className="mt-6">
            <hr className="kk-rule" />
            {past.map(row)}
          </div>
        </details>
      )}
    </div>
  )
}
