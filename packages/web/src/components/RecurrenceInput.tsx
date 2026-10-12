'use client'

import { useState } from 'react'
import {
  DAY_NAMES,
  ORDINALS,
  ORDINAL_NAMES,
  WEEKDAYS,
  buildRecurrence,
  describeRecurrence,
  parseRecurrence,
  weekdayOf,
  type Ordinal,
  type Recurrence,
  type Weekday,
} from '@/lib/recurrence'

interface Props {
  /** RRULE string, or '' for no recurrence */
  value: string
  onChange: (rrule: string) => void
  /** Start of the event (datetime-local value) — supplies the default weekday */
  startsAt: string
}

const KIND_LABELS: Record<Recurrence['kind'], string> = {
  none: 'Does not repeat',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom (RRULE)',
}

/** "Repeats: weekly / monthly / custom" — a small builder for the patterns most Berlin events use. */
export function RecurrenceInput({ value, onChange, startsAt }: Props) {
  // Kept in local state so an empty weekly selection or an empty custom field doesn't snap back to "none".
  const [rec, setRec] = useState<Recurrence>(() => parseRecurrence(value))

  function update(next: Recurrence) {
    setRec(next)
    onChange(buildRecurrence(next) ?? '')
  }

  function switchKind(kind: Recurrence['kind']) {
    // datetime-local values are in the browser's time zone, so read the weekday there too
    const start = weekdayOf(startsAt ? new Date(startsAt) : new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone)
    if (kind === 'none') update({ kind })
    else if (kind === 'weekly') update({ kind, days: [start.day] })
    else if (kind === 'monthly') update({ kind, ordinal: start.ordinal, day: start.day })
    else update({ kind, rrule: buildRecurrence(rec) ?? '' })
  }

  const rrule = buildRecurrence(rec)

  return (
    <fieldset className="kk-field m-0 min-w-0 border-0 p-0">
      <legend className="mb-2 p-0">
        Repeats <span className="kk-field__opt">(optional)</span>
      </legend>

      <select
        value={rec.kind}
        onChange={(e) => switchKind(e.target.value as Recurrence['kind'])}
        aria-label="Repeats"
        className="kk-input"
      >
        {(Object.keys(KIND_LABELS) as Recurrence['kind'][]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>

      {rec.kind === 'weekly' && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Days of the week">
          {WEEKDAYS.map((d) => {
            const on = rec.days.includes(d)
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={DAY_NAMES[d]}
                onClick={() => update({ kind: 'weekly', days: on ? rec.days.filter((x) => x !== d) : [...rec.days, d] })}
                className="kk-tag kk-tag--filter min-w-[3.25rem] justify-center"
              >
                {DAY_NAMES[d].slice(0, 2)}
              </button>
            )
          })}
        </div>
      )}

      {rec.kind === 'monthly' && (
        <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-2">
          <span className="text-[15px] font-normal text-muted">Every</span>
          <select
            value={rec.ordinal}
            onChange={(e) => update({ ...rec, ordinal: Number(e.target.value) as Ordinal })}
            aria-label="Which week of the month"
            className="kk-input"
          >
            {ORDINALS.map((o) => (
              <option key={o} value={o}>
                {ORDINAL_NAMES[o]}
              </option>
            ))}
          </select>
          <select
            value={rec.day}
            onChange={(e) => update({ ...rec, day: e.target.value as Weekday })}
            aria-label="Weekday"
            className="kk-input"
          >
            {WEEKDAYS.map((d) => (
              <option key={d} value={d}>
                {DAY_NAMES[d]}
              </option>
            ))}
          </select>
        </div>
      )}

      {rec.kind === 'custom' && (
        <input
          value={rec.rrule}
          onChange={(e) => update({ kind: 'custom', rrule: e.target.value })}
          placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=FR"
          aria-label="Custom RRULE"
          className="kk-input kk-input--mono"
        />
      )}

      {rec.kind !== 'none' && (
        <span className="kk-hint">
          {rec.kind === 'weekly' && !rrule
            ? 'Pick at least one day.'
            : rec.kind === 'custom'
              ? 'An iCalendar RRULE, for patterns like every other week or an end date.'
              : `${describeRecurrence(rrule!)} · ${rrule}`}
        </span>
      )}
    </fieldset>
  )
}
