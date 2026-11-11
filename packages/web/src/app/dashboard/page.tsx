import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { canEdit, type EventSlim } from '@open-event-db/shared'
import { ALL_STATUSES, getEvent, getEvents } from '@/lib/api'
import { getCurrentAccount } from '@/lib/session'
import { permissionActor, permissionEvent } from '@/lib/permissions'
import { isHappeningNow, isUpcoming } from '@/lib/format'
import { EventRow } from '@/components/EventRow'
import { Headline } from '@/components/Headline'
import { NextIcon } from '@/components/Icons'

export const metadata: Metadata = { title: 'Dashboard' }

function partition(events: EventSlim[], now = new Date()) {
  const happening: EventSlim[] = []
  const upcoming: EventSlim[] = []
  const past: EventSlim[] = []
  for (const e of events) {
    if (isUpcoming(e, now)) upcoming.push(e)
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

const listQuery = (key: 'organizer_id' | 'added_by', id: string) =>
  new URLSearchParams({ [key]: id, status: ALL_STATUSES, from: '2000-01-01T00:00:00Z', limit: '100' })

export default async function DashboardPage() {
  const me = await getCurrentAccount()
  if (!me) redirect('/login')

  // Members see the events of their verified organizers; scouts also see the events they added (claimed or not)
  const verified = me.organizers.filter((o) => o.verified)
  const isMember = verified.length > 0
  const canCreate = isMember || me.is_scout
  const now = new Date()
  const actor = permissionActor(me)

  const organizerEvents = new Map<string, EventSlim>()
  for (const { data } of await Promise.all(verified.map((o) => getEvents(listQuery('organizer_id', o.id))))) {
    for (const e of data) organizerEvents.set(e.id, e)
  }
  const mine = [...organizerEvents.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const added = me.is_scout ? (await getEvents(listQuery('added_by', me.id))).data : []

  // Claimed events the scout added are read-only for them, unless they belong to its organizer; name who claimed them
  const claimedBy = new Map<string, string>()
  const editable = new Set<string>()
  const claimed = await Promise.all(added.filter((e) => e.claimed).map((e) => getEvent(e.id)))
  for (const d of claimed) {
    if (!d) continue
    if (canEdit(permissionEvent(d), actor)) editable.add(d.id)
    const creator = d.organizers.find((o) => o.role === 'creator')
    if (creator) claimedBy.set(d.id, creator.name)
  }

  const claimedAction = (e: EventSlim) =>
    e.claimed && !editable.has(e.id) ? (
      <span className="kk-badge kk-badge--scout">Claimed by {claimedBy.get(e.id) ?? 'organizer'}</span>
    ) : (
      editLink(e.id)
    )

  const render = (events: EventSlim[], action: (e: EventSlim) => React.ReactNode, titleId: string) => {
    const { happening, upcoming, past } = partition(events, now)
    const row = (e: EventSlim) => <EventRow key={e.id} event={e} showDate action={action(e)} titleSize={22} now={now} />
    return (
      <>
        {happening.length > 0 && (
          <section aria-labelledby={`${titleId}-now`}>
            <h2 id={`${titleId}-now`} className="kk-section-title">
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
      </>
    )
  }


  return (
    <div className="kk-container" style={{ gap: 56 }}>
      <section className="flex flex-wrap items-end justify-between gap-5">
        <div className="kk-intro" style={{ gap: 12 }}>
          <p className="kk-eyebrow">Dashboard</p>
          <Headline text={me.display_name} style={{ fontSize: 'clamp(64px, 9vw, 120px)' }} />
          {me.is_scout && (
            <p className="m-0 text-body text-muted">
              <span className="kk-badge kk-badge--scout">Scout</span> Events you add go live right away. They count as
              the venue’s once its website lists them, and as the organizer’s once they claim them.
            </p>
          )}
          {verified.map((o) => (
            <Link key={o.id} href={`/organizers/${o.slug}`} className="text-body text-muted">
              View public page of {o.name}
              <NextIcon />
            </Link>
          ))}
        </div>
        {canCreate && (
          <Link href="/events/new" className="kk-btn kk-btn--primary kk-btn--lg">
            + Create event
          </Link>
        )}
      </section>

      {!canCreate && (
        <section>
          <h2 className="kk-section-title">No events yet</h2>
          <hr className="kk-rule" />
          <p className="kk-empty">Events can be added by members of a verified organizer and by scouts.</p>
        </section>
      )}

      {canCreate && mine.length === 0 && added.length === 0 && (
        <section>
          <h2 className="kk-section-title">
            {me.is_scout ? 'You’re in. Add your first event.' : 'You’re in. Create your first event.'}
          </h2>
          <hr className="kk-rule" />
          <p className="kk-empty">
            It will be live on the public listing as soon as you save it
            {me.is_scout && ', marked as not yet confirmed by the organizer'}.
          </p>
        </section>
      )}

      {mine.length > 0 && (
        <>
          <h2 className="kk-eyebrow">Your organizers’ events</h2>
          {render(mine, (e) => editLink(e.id), 'organizer')}
        </>
      )}

      {added.length > 0 && (
        <>
          <h2 className="kk-eyebrow">Events you added</h2>
          {render(added, claimedAction, 'added')}
        </>
      )}
    </div>
  )
}
