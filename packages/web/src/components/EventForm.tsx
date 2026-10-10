'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EventDetail, EventOwnerRole, EventStatus } from '@open-event-db/shared'
import { LinksEditor, fromLinkRows, toLinkRows, type LinkRow } from './LinksEditor'
import { VenuePicker, type VenueOption } from './VenuePicker'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface Props {
  mode: 'create' | 'edit'
  event?: EventDetail
  role?: EventOwnerRole
  knownTags: string[]
}

const LINK_KEYS = ['website', 'tickets', 'ra', 'instagram', 'facebook', 'telegram', 'soundcloud']

const pad = (n: number) => String(n).padStart(2, '0')
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

export function EventForm({ mode, event, role, knownTags }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState(event?.title ?? '')
  const [startsAt, setStartsAt] = useState(toLocalInput(event?.starts_at))
  const [endsAt, setEndsAt] = useState(toLocalInput(event?.ends_at))
  const [venue, setVenue] = useState<VenueOption | null>(event?.venue ?? null)
  const [creatingVenue, setCreatingVenue] = useState(false)
  const [locationText, setLocationText] = useState(event?.location_text ?? '')
  const [city, setCity] = useState(event?.city ?? 'Berlin')
  const [description, setDescription] = useState(event?.description ?? '')
  const [tags, setTags] = useState((event?.tags ?? []).join(', '))
  const [links, setLinks] = useState<LinkRow[]>(toLinkRows(event?.links))
  const [recurrence, setRecurrence] = useState(event?.recurrence ?? '')
  const [status, setStatus] = useState<EventStatus>(event?.status ?? 'scheduled')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const statusOptions: EventStatus[] =
    role === 'creator' ? ['scheduled', 'postponed', 'cancelled'] : ['scheduled', 'postponed']

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
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      links: fromLinkRows(links),
      recurrence: recurrence || null,
    }
    if (!venue) payload.city = city
    if (mode === 'edit') payload.status = status

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
      router.push(`/events/${json.data.id}`)
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
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className="kk-input kk-input--title" />
        </label>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          <label className="kk-field">
            Starts
            <input
              type="datetime-local"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="kk-input"
            />
          </label>
          <label className="kk-field">
            <span>
              Ends <span className="kk-field__opt">(optional)</span>
            </span>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="kk-input" />
          </label>
        </div>

        <VenuePicker value={venue} onChange={setVenue} onCreatingChange={setCreatingVenue} />

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

        <label className="kk-field">
          <span>
            Description <span className="kk-field__opt">(optional)</span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="What to expect, line-up, door policy, accessibility…"
            className="kk-input"
          />
        </label>

        <label className="kk-field">
          <span>
            Tags <span className="kk-field__opt">(comma-separated)</span>
          </span>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            list="known-tags"
            placeholder="techno, open-air"
            className="kk-input"
          />
          <datalist id="known-tags">
            {knownTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>

        <div className="kk-field">
          Links
          <LinksEditor rows={links} onChange={setLinks} suggestedKeys={LINK_KEYS} />
        </div>

        <label className="kk-field">
          <span>
            Recurrence <span className="kk-field__opt">(optional iCal RRULE, e.g. FREQ=WEEKLY;BYDAY=FR)</span>
          </span>
          <input
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
            placeholder="FREQ=WEEKLY;BYDAY=FR"
            className="kk-input kk-input--mono"
          />
        </label>

        {mode === 'edit' && (
          <label className="kk-field">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as EventStatus)} className="kk-input">
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {role === 'co_owner' && <span className="kk-hint">Only the event creator can cancel an event.</span>}
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
