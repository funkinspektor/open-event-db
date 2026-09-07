import type { EventStatus } from '@open-event-db/shared'

export function StatusBadge({ status }: { status: EventStatus }) {
  if (status === 'scheduled') return null
  const styles =
    status === 'cancelled'
      ? 'bg-red-50 text-red-700 ring-red-600/20'
      : 'bg-amber-50 text-amber-800 ring-amber-600/20'
  const label = status === 'cancelled' ? 'Cancelled' : 'Postponed'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}
    >
      {label}
    </span>
  )
}

export function StatusBanner({ status }: { status: EventStatus }) {
  if (status === 'scheduled') return null
  const cancelled = status === 'cancelled'
  return (
    <div
      role="status"
      className={`rounded-lg border px-4 py-3 text-sm font-medium ${
        cancelled
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      {cancelled ? 'This event has been cancelled.' : 'This event has been postponed.'}
    </div>
  )
}
