'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { DuplicateCandidate, IngestItemView, IngestView } from '@open-event-db/shared'
import { categoryLabel } from '@/lib/categories'
import { isDayOnly } from '@/lib/draft-start'
import { formatDate, formatTimeRange, knownStart } from '@/lib/format'
import { submitterLine } from '@/lib/ingest-submitter'
import { Markdown } from './Markdown'

interface Props {
  item: IngestItemView
  view: IngestView
  selected: boolean
  busy: boolean
  onSelect: (selected: boolean) => void
  onAccept: () => void
  /** `reason` is the optional note a suggestion's submitter sees. */
  onReject: (reason?: string) => void
  onLink: (eventId: string) => void
  onGone: (action: 'cancel' | 'keep') => void
}

const VERDICT_BADGE = {
  fit: { className: 'kk-badge kk-badge--fit', label: 'Fits' },
  maybe: { className: 'kk-badge kk-badge--scout', label: 'Maybe' },
  no: { className: 'kk-badge kk-badge--scout', label: "Doesn't fit" },
} as const

/** A possible duplicate with the button to link the item to it instead of accepting. */
export function Duplicate({ d, busy, onLink }: { d: DuplicateCandidate; busy: boolean; onLink: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span className="min-w-0 text-[15px]">
        <Link href={`/events/${d.id}`} target="_blank" className="font-bold">
          {d.title}
        </Link>
        <span className="text-muted">
          {' '}
          · {formatDate(d.starts_at)} {formatTimeRange(knownStart(d), d.ends_at)}
          {d.venue_name && ` · ${d.venue_name}`} · added by {d.added_by_name}
        </span>
      </span>
      <button type="button" onClick={onLink} disabled={busy} className="kk-btn kk-btn--outline">
        Link to this event
      </button>
    </li>
  )
}

/** One feed item in the scout inbox: what the feed says, plus the decision buttons. */
export function IngestItemCard({ item, view, selected, busy, onSelect, onAccept, onReject, onLink, onGone }: Props) {
  const { draft } = item
  const gone = view === 'gone'
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const suggestion = item.source.kind === 'suggestion'
  const category = categoryLabel(draft.categories)
  const where = draft.venue_id ? (
    <Link href={`/venues/${draft.venue_id}`}>{item.venue_name ?? draft.location_text ?? 'Venue'}</Link>
  ) : (
    (draft.location_text ?? 'Location TBA')
  )

  return (
    <article className="kk-event" style={{ alignItems: 'flex-start' }} aria-busy={busy}>
      {!gone && (
        <input
          type="checkbox"
          checked={selected}
          disabled={busy}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`Select “${draft.title}” for rejecting`}
          className="mt-1.5 h-5 w-5 flex-none accent-[var(--uv)]"
        />
      )}
      <div className="kk-event__when">
        <span className="kk-event__date">{formatDate(draft.starts_at)}</span>
        {/* A suggestion sent with a day only has no time to show */}
        {!isDayOnly(draft, item.source.kind) && (
          <span className="kk-event__time">{formatTimeRange(draft.starts_at, draft.ends_at)}</span>
        )}
      </div>
      <div className="kk-event__main flex flex-col gap-3">
        <div>
          <h3 className="kk-event__title" style={{ fontSize: 22 }}>
            <Link href={`/ingest/${item.id}`}>{draft.title}</Link>
          </h3>
          <p className="kk-event__meta">
            {category && <>{category} · </>}
            {where} · {draft.city}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {suggestion && item.submitter ? (
            <span className="kk-badge kk-badge--scout">{submitterLine(item.submitter)}</span>
          ) : (
            <span className="kk-badge kk-badge--scout">{item.source.name}</span>
          )}
          {item.fit && (
            <span className={VERDICT_BADGE[item.fit.verdict].className}>{VERDICT_BADGE[item.fit.verdict].label}</span>
          )}
          {draft.times_unverified && <span className="kk-badge kk-badge--postponed">Times unverified</span>}
          {gone && <span className="kk-badge kk-badge--cancelled">Gone from source</span>}
          {draft.source_url && (
            <a href={draft.source_url} target="_blank" rel="noopener noreferrer" className="text-[15px]">
              Original
            </a>
          )}
          {gone && item.event_id && (
            <Link href={`/events/${item.event_id}`} className="text-[15px]">
              Open event
            </Link>
          )}
        </div>

        {item.fit && <p className="kk-hint m-0 text-[14px]">{item.fit.reason}</p>}

        {draft.description.trim() && (
          <details className="kk-disclosure">
            <summary>
              <span className="text-[15px] text-muted">Description</span>
            </summary>
            <Markdown text={draft.description} className="mt-3" />
          </details>
        )}

        {rejecting && (
          <div className="flex flex-col gap-3">
            <label className="kk-field">
              Reason (shown to the person)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                className="kk-input"
              />
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => onReject(reason.trim() || undefined)}
                disabled={busy}
                className="kk-btn kk-btn--primary"
              >
                Confirm reject
              </button>
              <button type="button" onClick={() => setRejecting(false)} disabled={busy} className="kk-btn kk-btn--text">
                Cancel
              </button>
            </div>
          </div>
        )}

        {!gone && item.duplicates.length > 0 && (
          <div className="kk-notice flex flex-col gap-3">
            <p className="m-0 font-bold">Possible duplicate</p>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {item.duplicates.map((d) => (
                <Duplicate key={d.id} d={d} busy={busy} onLink={() => onLink(d.id)} />
              ))}
            </ul>
          </div>
        )}
      </div>

      {draft.image_url && (
        <span className="kk-thumb flex-none">
          {/* Feed hosts are arbitrary, so no next/image optimisation. */}
          <img src={draft.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
        </span>
      )}

      <div className="kk-event__aside">
        {gone ? (
          <>
            <button type="button" onClick={() => onGone('keep')} disabled={busy} className="kk-btn kk-btn--outline">
              Keep
            </button>
            <button type="button" onClick={() => onGone('cancel')} disabled={busy} className="kk-btn kk-btn--light">
              Cancel event
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => (suggestion ? setRejecting(true) : onReject())}
              disabled={busy || rejecting}
              className="kk-btn kk-btn--outline"
            >
              Reject
            </button>
            <Link href={`/ingest/${item.id}/edit`} className="kk-btn kk-btn--outline">
              Edit &amp; accept
            </Link>
            <button type="button" onClick={onAccept} disabled={busy} className="kk-btn kk-btn--primary">
              Accept
            </button>
          </>
        )}
      </div>
    </article>
  )
}
