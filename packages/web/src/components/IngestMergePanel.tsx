'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { EventDetail, IngestItemDetail } from '@open-event-db/shared'
import { categoryLabel } from '@/lib/categories'
import { formatDate, formatTimeRange, knownStart } from '@/lib/format'
import { ingestAction } from '@/lib/ingest-actions'
import { linkBody, mergeRows, sideOf, type MergeKey, type MergeRow, type MergeSide } from '@/lib/merge'
import { markdownToPlainText } from '@/lib/plaintext'

interface Props {
  item: IngestItemDetail
  event: EventDetail
  /** False for an event its owners claimed: the link then only settles the item. */
  editable: boolean
}

const Empty = () => <span className="text-muted">—</span>

/** One side of a row, as the event page would show it. */
function Value({ row, side, item, event }: { row: MergeRow; side: MergeSide; item: IngestItemDetail; event: EventDetail }) {
  const { draft } = item
  const feed = side === 'feed'
  if (row.key.startsWith('link:')) {
    const url = (feed ? draft.links : event.links)[row.key.slice('link:'.length)]
    return url ? <span className="break-all">{url}</span> : <Empty />
  }
  switch (row.key as Exclude<MergeKey, `link:${string}`>) {
    case 'title':
      return <span className="font-bold">{feed ? draft.title : event.title}</span>
    case 'description': {
      const text = markdownToPlainText(feed ? draft.description : event.description)
      return text ? <div className="max-h-48 overflow-y-auto whitespace-pre-wrap">{text}</div> : <Empty />
    }
    case 'lineup': {
      const groups = feed ? draft.lineup : event.lineup
      if (groups.length === 0) return <Empty />
      return (
        <div className="max-h-48 overflow-y-auto">
          {groups.map((g, i) => (
            <p key={i} className="m-0">
              {g.name && <span className="font-bold">{g.name}: </span>}
              {g.acts.map((a) => a.name).join(', ')}
            </p>
          ))}
        </div>
      )
    }
    case 'times': {
      if (feed) {
        const when = `${formatDate(draft.starts_at)} ${formatTimeRange(draft.starts_at, draft.ends_at)}`
        return <span>{draft.times_unverified ? `${when} (unverified)` : when}</span>
      }
      return <span>{`${formatDate(event.starts_at)} ${formatTimeRange(knownStart(event), event.ends_at)}`}</span>
    }
    case 'place': {
      const name = feed ? (item.venue?.name ?? draft.location_text) : (event.venue?.name ?? event.location_text)
      return name ? <span>{`${name} · ${feed ? draft.city : event.city}`}</span> : <Empty />
    }
    case 'categories':
      return <span>{categoryLabel(feed ? draft.categories : event.categories) ?? '—'}</span>
    case 'image': {
      const src = feed ? draft.image_url : event.image_url
      // Feed hosts are arbitrary, so no next/image optimisation.
      return src ? <img src={src} alt="" className="max-h-32 w-auto rounded-[var(--radius-s)]" /> : <Empty />
    }
  }
}

function Option({ checked, disabled, name, onPick, label, children }: {
  checked: boolean
  disabled: boolean
  name: string
  onPick: () => void
  label: string
  children: ReactNode
}) {
  return (
    <label
      className={`flex min-w-0 flex-1 basis-64 cursor-pointer flex-col gap-2 rounded-[var(--radius-m)] border p-3 text-[15px] ${
        checked ? 'border-[var(--uv)] bg-[var(--uv-wash)]' : 'border-[var(--border)]'
      } ${disabled ? 'cursor-default opacity-70' : ''}`}
    >
      <span className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.06em] text-muted">
        <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onPick} className="accent-[var(--uv)]" />
        {label}
      </span>
      {children}
    </label>
  )
}

/** Linking a feed item to an existing event: per differing field, which version the event keeps. */
export function IngestMergePanel({ item, event, editable }: Props) {
  const router = useRouter()
  const rows = editable ? mergeRows(event, item.draft) : []
  const [choice, setChoice] = useState<Partial<Record<MergeKey, MergeSide>>>({})
  const [sync, setSync] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const source = item.source.name
  const body = linkBody(event.id, rows, choice, sync)
  const taking = body.fields.length + body.links.length

  async function link() {
    setError(null)
    setBusy(true)
    const result = await ingestAction<{ event_id: string }>(`items/${item.id}/link`, body)
    if ('data' in result) {
      router.push(`/events/${event.id}?saved=${taking ? 'merged' : 'linked'}`)
      router.refresh()
      return // stays busy until the event page is there
    }
    setBusy(false)
    setError(result.error)
    if (result.status === 409) router.refresh()
  }

  return (
    <section className="kk-panel" aria-label="Link to an existing event" aria-busy={busy}>
      <div className="flex flex-col gap-2">
        <h2 className="m-0 text-[22px]">
          Link to <Link href={`/events/${event.id}`} target="_blank">{event.title}</Link>
        </h2>
        <p className="m-0 text-[15px] text-muted">
          {!editable
            ? 'Its organisers claimed this event, so it stays as they wrote it. Linking only settles the feed item.'
            : rows.length
              ? `Pick which version the event keeps. Fields that match ${source} are not shown.`
              : `The event already matches ${source}.`}
        </p>
      </div>

      {rows.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-5 p-0">
          {rows.map((row) => {
            const side = sideOf(row, choice, sync)
            const locked = sync && row.synced
            const pick = (s: MergeSide) => setChoice((prev) => ({ ...prev, [row.key]: s }))
            return (
              <li key={row.key} className="flex flex-col gap-2">
                <span className="text-[14px] font-bold">{row.label}</span>
                <div className="flex flex-wrap gap-3">
                  <Option name={row.key} label="Event" checked={side === 'event'} disabled={busy || locked} onPick={() => pick('event')}>
                    <Value row={row} side="event" item={item} event={event} />
                  </Option>
                  <Option name={row.key} label={source} checked={side === 'feed'} disabled={busy || locked} onPick={() => pick('feed')}>
                    <Value row={row} side="feed" item={item} event={event} />
                  </Option>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {editable && (
        <label className="flex cursor-pointer items-start gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={sync}
            disabled={busy}
            onChange={(e) => setSync(e.target.checked)}
            className="mt-1 h-5 w-5 flex-none accent-[var(--uv)]"
          />
          <span>
            <span className="font-bold">Let {source} keep this event up to date</span>
            <span className="block text-muted">
              Title, description, time, place, category and image then always come from the feed, and you’ll hear when the
              event leaves it. The next edit by hand ends that.
            </span>
          </span>
        </label>
      )}

      {error && (
        <div className="kk-alert" role="alert">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Link href={`/ingest/${item.id}`} className="kk-btn kk-btn--outline">
          Cancel
        </Link>
        <button type="button" onClick={link} disabled={busy} className="kk-btn kk-btn--primary">
          {taking ? `Link and take ${taking} from ${source}` : 'Link'}
        </button>
      </div>
    </section>
  )
}
