import type { EventStatus } from '@open-event-db/shared'

export function StatusBadge({ status }: { status: EventStatus }) {
  if (status === 'scheduled') return null
  return status === 'cancelled' ? (
    <span className="kk-badge kk-badge--cancelled">Cancelled</span>
  ) : (
    <span className="kk-badge kk-badge--postponed">Postponed</span>
  )
}

export function StatusBanner({ status }: { status: EventStatus }) {
  if (status === 'scheduled') return null
  return status === 'cancelled' ? (
    <div className="kk-alert kk-alert--cancelled" role="status">
      Cancelled — this event will not take place.
    </div>
  ) : (
    <div className="kk-alert" role="status">
      <span aria-hidden>●</span> Postponed — a new date has not been announced yet.
    </div>
  )
}
