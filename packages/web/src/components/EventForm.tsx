'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EVENT_CATEGORIES, type EventCategory, type EventDetail, type EventStatus } from '@open-event-db/shared'
import { CATEGORY_LABELS } from '@/lib/categories'
import { toLocalInput, type ImportResult } from '@/lib/draft'
import { dayKey } from '@/lib/format'
import type { DuplicateDraft } from '@/lib/duplicates'
import { imageSaveOutcome, savedParam, type ImageSaveOutcome } from '@/lib/image-save'
import { fromLineupRows, toLineupRows, type LineupGroupRow } from '@/lib/lineup'
import { EventImageInput, type ImageChange } from './EventImageInput'
import { LineupEditor } from './LineupEditor'
import { Markdown } from './Markdown'
import { LinksEditor, fromLinkRows, toLinkRows, type LinkRow } from './LinksEditor'
import { RecurrenceInput } from './RecurrenceInput'
import { TagInput } from './TagInput'
import { VenuePicker, type VenueOption } from './VenuePicker'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface Props {
  mode: 'create' | 'edit'
  event?: EventDetail
  /** Edit mode: whether the current account may set `cancelled` (creator, or a scout on an unclaimed event). */
  canCancel?: boolean
  knownTags: string[]
  /** Create mode after an image import: pre-fills the form and marks what couldn't be read. */
  imported?: ImportResult
  /** Create mode: called with the fields the duplicate lookup needs, on mount and whenever one of them changes. Pass a stable callback. */
  onDraftChange?: (d: DuplicateDraft) => void
}

/** Sends the image change for a saved event. */
async function saveImage(eventId: string, change: ImageChange): Promise<ImageSaveOutcome> {
  if (change.kind === 'keep') return 'saved'
  try {
    const res = await fetch(`${API_URL}/api/v1/events/${eventId}/image`, {
      method: change.kind === 'replace' ? 'PUT' : 'DELETE',
      credentials: 'include',
      ...(change.kind === 'replace' ? { headers: { 'content-type': change.blob.type || 'image/jpeg' }, body: change.blob } : {}),
    })
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string } }
    return imageSaveOutcome(res.status, json.error?.code)
  } catch {
    return 'failed'
  }
}

const LINK_KEYS = ['website', 'tickets', 'ra', 'instagram', 'facebook', 'telegram', 'soundcloud']

const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)
/** Like fromLocalInput, but tolerates a half-typed value while the user is still editing. */
const isoOrNull = (v: string) => {
  const d = v ? new Date(v) : null
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null
}

/** A saved event's start as form values; one without a known time keeps its Berlin day. */
function startFields(e: EventDetail): { date: string; time: string } {
  if (!e.start_time_known) return { date: dayKey(e.starts_at), time: '' }
  const [date = '', time = ''] = toLocalInput(e.starts_at).split('T')
  return { date, time }
}

export function EventForm({ mode, event, canCancel = false, knownTags, imported, onDraftChange }: Props) {
  const router = useRouter()
  const pre = imported?.prefill
  const [title, setTitle] = useState(event?.title ?? pre?.title ?? '')
  // Date and time are separate fields: flyers nearly always have the date, often not the time
  const start = event ? startFields(event) : { date: pre?.startDate ?? '', time: pre?.startTime ?? '' }
  const [startDate, setStartDate] = useState(start.date)
  const [startTime, setStartTime] = useState(start.time)
  const [endsAt, setEndsAt] = useState(event ? toLocalInput(event.ends_at) : (pre?.endsAt ?? ''))
  const [venue, setVenue] = useState<VenueOption | null>(event?.venue ?? imported?.venue ?? null)
  const [creatingVenue, setCreatingVenue] = useState(!!imported?.newVenue)
  const [locationText, setLocationText] = useState(event?.location_text ?? pre?.locationText ?? '')
  const [city, setCity] = useState(event?.city ?? pre?.city ?? 'Berlin')
  const [description, setDescription] = useState(event?.description ?? pre?.description ?? '')
  const [lineup, setLineup] = useState<LineupGroupRow[]>(() => toLineupRows(event?.lineup ?? pre?.lineup ?? []))
  const [previewing, setPreviewing] = useState(false)
  const [categories, setCategories] = useState<EventCategory[]>(event?.categories ?? pre?.categories ?? [])
  const [tags, setTags] = useState<string[]>(event?.tags ?? pre?.tags ?? [])
  const [links, setLinks] = useState<LinkRow[]>(event ? toLinkRows(event.links) : (pre?.links ?? []))
  const [recurrence, setRecurrence] = useState(event?.recurrence ?? '')
  const [status, setStatus] = useState<EventStatus>(event?.status ?? 'scheduled')
  const [image, setImage] = useState<ImageChange>({ kind: 'keep' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // As a datetime-local value; without a time the event starts with its day
  const startsAt = startDate ? `${startDate}T${startTime || '00:00'}` : ''
  const venueId = venue?.id ?? null
  useEffect(() => {
    if (mode !== 'create') return
    onDraftChange?.({
      venueId,
      locationText: venueId ? null : locationText.trim() || null,
      startsAt: isoOrNull(startsAt),
      endsAt: isoOrNull(endsAt),
      title,
    })
  }, [mode, onDraftChange, venueId, locationText, startsAt, endsAt, title])

  // After an import, empty fields stay marked until filled: they're the ones the image didn't have
  const missing = (empty: boolean) => (imported && empty ? ' kk-input--missing' : '')
  const suggestedTags = (pre?.suggestedTags ?? []).filter((t) => !tags.includes(t))

  const statusOptions: EventStatus[] =
    canCancel ? ['scheduled', 'postponed', 'cancelled'] : ['scheduled', 'postponed']
  // Co-owners can't cancel, but an event that's already cancelled must still show its real status.
  if (event?.status === 'cancelled' && !statusOptions.includes('cancelled')) statusOptions.push('cancelled')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (mode === 'edit' && status === 'cancelled' && event?.status !== 'cancelled') {
      const ok = window.confirm(
        'This will mark the event as cancelled. It will still be visible but shown as cancelled.',
      )
      if (!ok) return
    }

    const payload: Record<string, unknown> = {
      title,
      // A bare day tells the API the start time isn't known
      starts_at: startTime ? fromLocalInput(startsAt) : startDate,
      ends_at: fromLocalInput(endsAt),
      description,
      lineup: fromLineupRows(lineup),
      venue_id: venue?.id ?? null,
      location_text: venue ? null : locationText || null,
      categories,
      tags,
      links: fromLinkRows(links),
      recurrence: recurrence || null,
    }
    if (!venue) payload.city = city
    // Only send the status when it changed: the API rejects `cancelled` from co-owners,
    // so re-sending an unchanged `cancelled` would block co-owners from editing anything else.
    if (mode === 'edit' && status !== event?.status) payload.status = status

    setBusy(true)
    try {
      const res = await fetch(
        mode === 'create' ? `${API_URL}/api/v1/events` : `${API_URL}/api/v1/events/${event!.id}`,
        {
          method: mode === 'create' ? 'POST' : 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const json = (await res.json()) as { data?: { id: string }; error?: { message: string } }
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? `Request failed (${res.status})`)
        return
      }
      // The event is saved either way; a failed image only changes the message on the event page
      router.push(`/events/${json.data.id}?saved=${savedParam(mode, await saveImage(json.data.id, image))}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[18px]">
      <div className="kk-panel">
        <label className="kk-field">
          Title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={'kk-input kk-input--title' + missing(!title.trim())}
          />
        </label>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <label className="kk-field">
              Date
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={'kk-input' + missing(!startDate)}
              />
            </label>
            <label className="kk-field">
              <span>
                Start <span className="kk-field__opt">(optional)</span>
              </span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={'kk-input' + missing(!startTime)}
              />
            </label>
            {imported && startDate && !startTime && (
              <span className="kk-hint col-span-2">No start time on the image. Leave it empty if it isn’t known.</span>
            )}
          </div>
          <label className="kk-field">
            <span>
              Ends <span className="kk-field__opt">(optional)</span>
            </span>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="kk-input" />
          </label>
        </div>

        <VenuePicker
          value={venue}
          onChange={setVenue}
          onCreatingChange={setCreatingVenue}
          fromImage={
            imported && !imported.venue
              ? { name: imported.venueName, candidates: imported.candidates, create: imported.newVenue }
              : undefined
          }
          missing={!!imported && !venue && !locationText.trim()}
        />

        {!venue && !creatingVenue && (
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <label className="kk-field">
              Location text
              <input
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
                placeholder="e.g. Tempelhofer Feld, Eingang Oderstraße"
                className="kk-input"
              />
            </label>
            <label className="kk-field">
              City
              <input required value={city} onChange={(e) => setCity(e.target.value)} className="kk-input" />
            </label>
          </div>
        )}

        <div className="kk-field">
          <div className="flex items-end justify-between gap-3">
            <label htmlFor="event-description">
              Description <span className="kk-field__opt">(optional, Markdown)</span>
            </label>
            <div className="flex gap-1.5" role="group" aria-label="Description view">
              {(['Write', 'Preview'] as const).map((label) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={previewing === (label === 'Preview')}
                  onClick={() => setPreviewing(label === 'Preview')}
                  className="kk-tag"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {previewing ? (
            <div className="kk-preview">
              {description.trim() ? (
                <Markdown text={description} className="text-[16px] leading-[1.6] text-ink-soft" />
              ) : (
                <p className="m-0 font-normal text-faint">Nothing to preview yet.</p>
              )}
            </div>
          ) : (
            <textarea
              id="event-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={imported ? 8 : 5}
              placeholder="What to expect, door policy, accessibility…"
              className={'kk-input' + missing(!description.trim())}
            />
          )}
          <span className="kk-hint">**bold**, *italic*, [link](https://…), - lists. Pasted URLs become links, line breaks are kept.</span>
        </div>

        <LineupEditor value={lineup} onChange={setLineup} description={description} />

        <div className="kk-field">
          <span id="event-category">
            Category <span className="kk-field__opt">(optional, both for a concert with a party)</span>
          </span>
          <div className="kk-pills" role="group" aria-labelledby="event-category">
            {EVENT_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className="kk-pill"
                aria-pressed={categories.includes(c)}
                onClick={() => setCategories(EVENT_CATEGORIES.filter((x) => (x === c) !== categories.includes(x)))}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        <TagInput value={tags} onChange={setTags} knownTags={knownTags} />
        {suggestedTags.length > 0 && (
          <div className="-mt-2 flex flex-wrap items-center gap-2">
            <span className="kk-hint">New tags from the image:</span>
            {suggestedTags.map((t) => (
              <button key={t} type="button" onClick={() => setTags([...tags, t])} className="kk-tag">
                + {t}
              </button>
            ))}
          </div>
        )}

        <EventImageInput current={event?.image_url ?? null} value={image} onChange={setImage} />

        <div className="kk-field">
          Links
          <LinksEditor rows={links} onChange={setLinks} suggestedKeys={LINK_KEYS} />
        </div>

        <RecurrenceInput value={recurrence} onChange={setRecurrence} startsAt={startsAt} />

        {mode === 'edit' && (
          <label className="kk-field">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as EventStatus)} className="kk-input">
              {statusOptions.map((s) => (
                <option key={s} value={s} disabled={s === 'cancelled' && !canCancel}>
                  {s}
                </option>
              ))}
            </select>
            {!canCancel && <span className="kk-hint">Only the event creator can cancel an event.</span>}
          </label>
        )}
      </div>

      {error && (
        <div className="kk-alert" role="alert">
          {error}
        </div>
      )}

      <div className="flex items-center gap-5">
        <button
          type="submit"
          disabled={busy || creatingVenue}
          title={creatingVenue ? 'Save or cancel the new venue first' : undefined}
          className="kk-btn kk-btn--primary kk-btn--lg"
        >
          {busy ? 'Saving…' : mode === 'create' ? 'Create event' : 'Save changes'}
        </button>
        <button type="button" onClick={() => router.back()} className="kk-btn kk-btn--text">
          Cancel
        </button>
      </div>
    </form>
  )
}
