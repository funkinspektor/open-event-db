'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EventDetail, EventStatus } from '@open-event-db/shared'
import { toLocalInput, type ImportResult } from '@/lib/draft'
import type { DuplicateDraft } from '@/lib/duplicates'
import { EventImageInput, type ImageChange } from './EventImageInput'
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

/** Sends the image change for a saved event; false when the image request failed. */
async function saveImage(eventId: string, change: ImageChange): Promise<boolean> {
  if (change.kind === 'keep') return true
  try {
    const res = await fetch(`${API_URL}/api/v1/events/${eventId}/image`, {
      method: change.kind === 'replace' ? 'PUT' : 'DELETE',
      credentials: 'include',
      ...(change.kind === 'replace' ? { headers: { 'content-type': change.blob.type || 'image/jpeg' }, body: change.blob } : {}),
    })
    return res.ok
  } catch {
    return false
  }
}

const LINK_KEYS = ['website', 'tickets', 'ra', 'instagram', 'facebook', 'telegram', 'soundcloud']

const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)
/** Like fromLocalInput, but tolerates a half-typed value while the user is still editing. */
const isoOrNull = (v: string) => {
  const d = v ? new Date(v) : null
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null
}

const formatDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  })

export function EventForm({ mode, event, canCancel = false, knownTags, imported, onDraftChange }: Props) {
  const router = useRouter()
  const pre = imported?.prefill
  const [title, setTitle] = useState(event?.title ?? pre?.title ?? '')
  const [startsAt, setStartsAt] = useState(event ? toLocalInput(event.starts_at) : (pre?.startsAt ?? ''))
  const [endsAt, setEndsAt] = useState(event ? toLocalInput(event.ends_at) : (pre?.endsAt ?? ''))
  const [venue, setVenue] = useState<VenueOption | null>(event?.venue ?? imported?.venue ?? null)
  const [creatingVenue, setCreatingVenue] = useState(!!imported?.newVenue)
  const [locationText, setLocationText] = useState(event?.location_text ?? pre?.locationText ?? '')
  const [city, setCity] = useState(event?.city ?? pre?.city ?? 'Berlin')
  const [description, setDescription] = useState(event?.description ?? pre?.description ?? '')
  const [previewing, setPreviewing] = useState(false)
  const [tags, setTags] = useState<string[]>(event?.tags ?? pre?.tags ?? [])
  const [links, setLinks] = useState<LinkRow[]>(event ? toLinkRows(event.links) : (pre?.links ?? []))
  const [recurrence, setRecurrence] = useState(event?.recurrence ?? '')
  const [status, setStatus] = useState<EventStatus>(event?.status ?? 'scheduled')
  const [image, setImage] = useState<ImageChange>({ kind: 'keep' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      starts_at: fromLocalInput(startsAt),
      ends_at: fromLocalInput(endsAt),
      description,
      venue_id: venue?.id ?? null,
      location_text: venue ? null : locationText || null,
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
      const imageSaved = await saveImage(json.data.id, image)
      const saved = mode === 'create' ? 'created' : 'updated'
      router.push(`/events/${json.data.id}?saved=${imageSaved ? saved : `${saved}_image_failed`}`)
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
          <label className="kk-field">
            Starts
            <input
              type="datetime-local"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className={'kk-input' + missing(!startsAt)}
            />
            {pre?.startDateOnly && !startsAt && (
              <span className="kk-hint kk-hint--warn">
                The image says {formatDay(pre.startDateOnly)} but no start time — please add it.
              </span>
            )}
          </label>
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
              placeholder="What to expect, line-up, door policy, accessibility…"
              className={'kk-input' + missing(!description.trim())}
            />
          )}
          <span className="kk-hint">**bold**, *italic*, [link](https://…), - lists. Pasted URLs become links, line breaks are kept.</span>
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
