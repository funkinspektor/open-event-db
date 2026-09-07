'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EventDetail, EventOwnerRole, EventStatus } from '@open-event-db/shared'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface VenueOption {
  id: string
  name: string
  city: string
}

interface Props {
  mode: 'create' | 'edit'
  event?: EventDetail
  venues: VenueOption[]
  role?: EventOwnerRole
  knownTags: string[]
}

type LinkRow = { key: string; url: string }

const LINK_KEYS = ['website', 'tickets', 'ra', 'instagram', 'facebook', 'telegram', 'soundcloud']

const pad = (n: number) => String(n).padStart(2, '0')
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

const input =
  'mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 disabled:bg-neutral-50 disabled:text-neutral-500'
const label = 'block text-sm font-medium text-neutral-800'

export function EventForm({ mode, event, venues, role, knownTags }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState(event?.title ?? '')
  const [startsAt, setStartsAt] = useState(toLocalInput(event?.starts_at))
  const [endsAt, setEndsAt] = useState(toLocalInput(event?.ends_at))
  const [venueId, setVenueId] = useState(event?.venue?.id ?? '')
  const [locationText, setLocationText] = useState(event?.location_text ?? '')
  const [city, setCity] = useState(event?.city ?? 'Berlin')
  const [description, setDescription] = useState(event?.description ?? '')
  const [tags, setTags] = useState((event?.tags ?? []).join(', '))
  const [links, setLinks] = useState<LinkRow[]>(
    Object.entries(event?.links ?? {}).map(([key, url]) => ({ key, url })),
  )
  const [recurrence, setRecurrence] = useState(event?.recurrence ?? '')
  const [status, setStatus] = useState<EventStatus>(event?.status ?? 'scheduled')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedVenue = useMemo(() => venues.find((v) => v.id === venueId), [venues, venueId])
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
      venue_id: venueId || null,
      location_text: locationText || null,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      links: Object.fromEntries(links.filter((l) => l.key && l.url).map((l) => [l.key.trim(), l.url.trim()])),
      recurrence: recurrence || null,
    }
    if (!venueId) payload.city = city
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
    <form onSubmit={submit} className="space-y-6">
      <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6">
        <label className={label}>
          Title
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            Starts
            <input
              type="datetime-local"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className={input}
            />
          </label>
          <label className={label}>
            Ends <span className="font-normal text-neutral-500">(optional)</span>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={input} />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            Venue
            <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className={input}>
              <option value="">No venue — use location text</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.city}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            City
            <input
              value={selectedVenue ? selectedVenue.city : city}
              onChange={(e) => setCity(e.target.value)}
              disabled={!!selectedVenue}
              required={!selectedVenue}
              className={input}
            />
          </label>
        </div>

        {!selectedVenue && (
          <label className={label}>
            Location text
            <input
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
              placeholder="e.g. Tempelhofer Feld, Eingang Oderstraße"
              className={input}
            />
          </label>
        )}

        <label className={label}>
          Description <span className="font-normal text-neutral-500">(optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className={input}
          />
        </label>

        <label className={label}>
          Tags <span className="font-normal text-neutral-500">(comma-separated)</span>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            list="known-tags"
            placeholder="techno, open-air"
            className={input}
          />
          <datalist id="known-tags">
            {knownTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>

        <div>
          <span className={label}>Links</span>
          <div className="mt-1 space-y-2">
            {links.map((row, i) => (
              <div key={i} className="flex gap-2">
                <input
                  list="link-keys"
                  value={row.key}
                  onChange={(e) => setLinks(links.map((l, j) => (j === i ? { ...l, key: e.target.value } : l)))}
                  placeholder="type"
                  className={`${input} mt-0 w-36`}
                />
                <input
                  type="url"
                  value={row.url}
                  onChange={(e) => setLinks(links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))}
                  placeholder="https://…"
                  className={`${input} mt-0 flex-1`}
                />
                <button
                  type="button"
                  onClick={() => setLinks(links.filter((_, j) => j !== i))}
                  className="rounded-md border border-neutral-300 px-2 text-sm text-neutral-600 hover:bg-neutral-50"
                  aria-label="Remove link"
                >
                  ×
                </button>
              </div>
            ))}
            <datalist id="link-keys">
              {LINK_KEYS.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => setLinks([...links, { key: '', url: '' }])}
              className="text-sm text-neutral-700 underline-offset-2 hover:underline"
            >
              + Add link
            </button>
          </div>
        </div>

        <label className={label}>
          Recurrence <span className="font-normal text-neutral-500">(optional iCal RRULE, e.g. FREQ=WEEKLY;BYDAY=FR)</span>
          <input value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={input} />
        </label>

        {mode === 'edit' && (
          <label className={label}>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as EventStatus)} className={input}>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {role === 'co_owner' && (
              <span className="mt-1 block text-xs text-neutral-500">Only the event creator can cancel an event.</span>
            )}
          </label>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy ? 'Saving…' : mode === 'create' ? 'Create event' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm text-neutral-600 hover:text-neutral-900"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
