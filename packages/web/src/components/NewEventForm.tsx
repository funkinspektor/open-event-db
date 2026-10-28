'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { DuplicateCandidate, EventDraft, Venue } from '@open-event-db/shared'
import { draftToPrefill, pickVenue, venueQueries, type ImportResult, type VenueMatchable } from '@/lib/draft'
import { duplicateQuery, type DuplicateDraft } from '@/lib/duplicates'
import { EventForm } from './EventForm'
import { EventImport } from './EventImport'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const DUPLICATE_DEBOUNCE_MS = 500

async function searchVenues(name: string): Promise<VenueMatchable[]> {
  for (const q of venueQueries(name)) {
    const res = await fetch(`${API_URL}/api/v1/venues?${new URLSearchParams({ q, limit: '8' })}`)
    if (!res.ok) return []
    const found = ((await res.json()) as { data: Venue[] }).data.map(({ id, name, city }) => ({ id, name, city }))
    if (found.length) return found
  }
  return []
}

/** Possible duplicates of what's been entered so far — a hint, never a block (PRD Event Capture, Decision 11). Likely ones first. */
async function findPossibleDuplicates(params: URLSearchParams, signal: AbortSignal): Promise<DuplicateCandidate[]> {
  const res = await fetch(`${API_URL}/api/v1/events/duplicates?${params}`, { signal })
  if (!res.ok) return []
  const { data } = (await res.json()) as { data: DuplicateCandidate[] }
  return [...data].sort((a, b) => Number(b.likely) - Number(a.likely))
}

const sameDraft = (a: DuplicateDraft, b: DuplicateDraft) =>
  a.venueId === b.venueId &&
  a.locationText === b.locationText &&
  a.startsAt === b.startsAt &&
  a.endsAt === b.endsAt &&
  a.title === b.title

/** The create page: optional image import on top, then the regular form — pre-filled after an import. */
export function NewEventForm({ knownTags }: { knownTags: string[] }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [imports, setImports] = useState(0)
  const [imageCount, setImageCount] = useState(1)
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([])
  const [draft, setDraft] = useState<DuplicateDraft | null>(null)

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
    },
    [knownTags],
  )

  // The form reports its fields on mount and on change — after an import it remounts pre-filled, which covers that path too.
  const onDraftChange = useCallback(
    (d: DuplicateDraft) => setDraft((prev) => (prev && sameDraft(prev, d) ? prev : d)),
    [],
  )

  useEffect(() => {
    const params = draft && duplicateQuery(draft)
    if (!params) {
      setDuplicates([])
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      findPossibleDuplicates(params, ctrl.signal).then(setDuplicates, () => {})
    }, DUPLICATE_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [draft])

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
        <EventForm key={imports} mode="create" knownTags={knownTags} imported={result ?? undefined} onDraftChange={onDraftChange} />
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
