'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import type { EventDraft, EventSlim, Venue } from '@open-event-db/shared'
import { draftToPrefill, pickVenue, venueQueries, type ImportResult, type VenueMatchable } from '@/lib/draft'
import { berlinDayStart } from '@/lib/filters'
import { EventForm } from './EventForm'
import { EventImport } from './EventImport'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const DAY = 24 * 60 * 60 * 1000

async function searchVenues(name: string): Promise<VenueMatchable[]> {
  for (const q of venueQueries(name)) {
    const res = await fetch(`${API_URL}/api/v1/venues?${new URLSearchParams({ q, limit: '8' })}`)
    if (!res.ok) return []
    const found = ((await res.json()) as { data: Venue[] }).data.map(({ id, name, city }) => ({ id, name, city }))
    if (found.length) return found
  }
  return []
}

/** Events on the same Berlin day at the same venue — a hint, never a block (PRD Event Capture, Decision 11). */
async function findPossibleDuplicates(venueId: string, day: string): Promise<EventSlim[]> {
  const from = berlinDayStart(day)
  const to = berlinDayStart(new Date(Date.parse(`${day}T12:00:00Z`) + DAY).toISOString().slice(0, 10))
  const params = new URLSearchParams({ venue_id: venueId, from: from.toISOString(), to: to.toISOString(), limit: '5' })
  const res = await fetch(`${API_URL}/api/v1/events?${params}`)
  if (!res.ok) return []
  return ((await res.json()) as { data: EventSlim[] }).data
}

/** The create page: optional image import on top, then the regular form — pre-filled after an import. */
export function NewEventForm({ knownTags }: { knownTags: string[] }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [imports, setImports] = useState(0)
  const [imageCount, setImageCount] = useState(1)
  const [duplicates, setDuplicates] = useState<EventSlim[]>([])

  const onImported = useCallback(
    async (draft: EventDraft, count: number) => {
      let venue: VenueMatchable | null = null
      let candidates: VenueMatchable[] = []
      if (draft.venue_name) {
        const found = await searchVenues(draft.venue_name).catch(() => [])
        ;({ venue, candidates } = pickVenue(draft.venue_name, found))
      }
      setResult({
        prefill: draftToPrefill(draft, knownTags),
        venue,
        candidates,
        venueName: draft.venue_name,
        newVenue:
          draft.venue_name && !venue && candidates.length === 0
            ? { name: draft.venue_name, address: draft.address ?? '', city: draft.city }
            : null,
      })
      setImports((n) => n + 1)
      setImageCount(count)
      setDuplicates([])
      if (venue && draft.start_date) {
        findPossibleDuplicates(venue.id, draft.start_date).then(setDuplicates, () => {})
      }
    },
    [knownTags],
  )

  return (
    <div className="flex flex-col gap-[18px]">
      <EventImport onImported={onImported} onBusyChange={setBusy} compact={!!result} />

      {result && !busy && (
        <div className="kk-notice" role="status">
          Extracted from your {imageCount > 1 ? 'images' : 'image'} — please check every field before publishing. Fields marked in yellow
          couldn’t be read.
        </div>
      )}

      {duplicates.length > 0 && !busy && (
        <div className="kk-alert flex-col !items-start !gap-1" role="status">
          <span>This event may already exist:</span>
          {duplicates.map((e) => (
            <Link key={e.id} href={`/events/${e.id}`} target="_blank" className="underline underline-offset-2">
              {e.title}
            </Link>
          ))}
        </div>
      )}

      {busy && <FormSkeleton />}
      {/* Kept mounted while an import runs, so a failed import doesn't lose what was typed */}
      <div hidden={busy}>
        <EventForm key={imports} mode="create" knownTags={knownTags} imported={result ?? undefined} />
      </div>
    </div>
  )
}

function FormSkeleton() {
  return (
    <div className="kk-panel" aria-hidden>
      {[52, 48, 48, 140, 48].map((h, i) => (
        <div key={i} className="flex flex-col gap-2">
          <span className="kk-skeleton h-[14px] w-24" />
          <span className="kk-skeleton" style={{ height: h }} />
        </div>
      ))}
    </div>
  )
}
