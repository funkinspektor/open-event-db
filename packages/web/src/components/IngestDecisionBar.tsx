'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { IngestItemDetail } from '@open-event-db/shared'
import { ingestAction } from '@/lib/ingest-actions'
import { Duplicate } from './IngestItemCard'

const SETTLED: Record<'accepted' | 'rejected' | 'over' | 'removed', string> = {
  accepted: 'Accepted',
  rejected: 'Rejected',
  over: 'Over before anyone decided',
  removed: 'Removed from the source before anyone decided',
}

/** The inbox preview's header: where the item comes from, possible duplicates and the decision for its state. */
export function IngestDecisionBar({ item }: { item: IngestItemDetail }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { draft, state } = item

  async function act<T>(path: string, body: unknown, then: (data: T) => string) {
    setError(null)
    setBusy(true)
    const result = await ingestAction<T>(path, body)
    if ('data' in result) {
      router.push(then(result.data))
      router.refresh()
      return // stays busy until the next page is there
    }
    setBusy(false)
    setError(result.error)
    // e.g. 409 because someone else decided it first — show the current state
    if (result.status === 409) router.refresh()
  }

  const accept = () => act<{ event_id: string }>(`items/${item.id}/accept`, {}, (d) => `/events/${d.event_id}?saved=accepted`)
  const reject = () => act(`items/reject`, { ids: [item.id] }, () => '/ingest')
  // Linking first compares the two: the page shows the merge panel for `?merge=`
  const link = (eventId: string) => router.push(`/ingest/${item.id}?merge=${eventId}`)
  const gone = (action: 'keep' | 'cancel') => act(`items/${item.id}/gone`, { action }, () => '/ingest?view=gone')

  return (
    <section className="kk-panel flex flex-col gap-4" aria-label="Inbox decision" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="kk-badge kk-badge--scout">{item.source.name}</span>
          {draft.times_unverified && <span className="kk-badge kk-badge--postponed">Times unverified</span>}
          {state === 'gone' && <span className="kk-badge kk-badge--cancelled">Gone from source</span>}
          {draft.source_url && (
            <a href={draft.source_url} target="_blank" rel="noopener noreferrer" className="text-[15px]">
              Original
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {state === 'new' && (
            <>
              <button type="button" onClick={reject} disabled={busy} className="kk-btn kk-btn--outline">
                Reject
              </button>
              <button type="button" onClick={accept} disabled={busy} className="kk-btn kk-btn--primary">
                Accept
              </button>
            </>
          )}
          {state === 'gone' && (
            <>
              <button type="button" onClick={() => gone('keep')} disabled={busy} className="kk-btn kk-btn--outline">
                Keep
              </button>
              <button type="button" onClick={() => gone('cancel')} disabled={busy} className="kk-btn kk-btn--light">
                Cancel event
              </button>
            </>
          )}
          {state !== 'new' && state !== 'gone' && <span className="text-[15px] text-muted">{SETTLED[state]}</span>}
          {state !== 'new' && item.event_id && (
            <Link href={`/events/${item.event_id}`} className="kk-btn kk-btn--outline">
              Open event
            </Link>
          )}
        </div>
      </div>

      {state === 'gone' && (
        <p className="m-0 text-[15px] text-muted">
          The source no longer lists this event. Keep it if it still takes place, or cancel it.
        </p>
      )}

      {state === 'new' && item.duplicates.length > 0 && (
        <div className="kk-notice flex flex-col gap-3">
          <p className="m-0 font-bold">Possible duplicate</p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {item.duplicates.map((d) => (
              <Duplicate key={d.id} d={d} busy={busy} onLink={() => link(d.id)} />
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="kk-alert" role="alert">
          {error}
        </div>
      )}
    </section>
  )
}
