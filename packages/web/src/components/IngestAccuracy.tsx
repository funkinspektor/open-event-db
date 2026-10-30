import type { IngestAccuracyRow } from '@open-event-db/shared'

/** "{count} of {decided} · {percent}%", or a dash while nothing is decided. */
function share(count: number, decided: number): string {
  if (decided === 0) return '—'
  return `${count} of ${decided} · ${Math.round((count / decided) * 100)}%`
}

/** How the LLM fit verdicts compare with what the scouts decided, per source. */
export function IngestAccuracy({ rows }: { rows: IngestAccuracyRow[] }) {
  return (
    <section aria-label="Accuracy" className="mt-16 flex flex-col gap-4">
      <h2 className="kk-eyebrow">Accuracy</h2>
      {rows.length === 0 ? (
        <p className="kk-hint m-0">No decisions on scored items in the last 60 days.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[15px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-muted">
                <th scope="col" className="py-2 pr-6 font-bold">
                  Source
                </th>
                <th scope="col" className="py-2 pr-6 font-bold">
                  Fits accepted
                </th>
                <th scope="col" className="py-2 pr-6 font-bold">
                  Doesn&apos;t fit rejected
                </th>
                <th scope="col" className="py-2 font-bold">
                  Rescued
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slug} className="border-b border-[var(--border)]">
                  <th scope="row" className="whitespace-nowrap py-3 pr-6 font-bold">
                    {r.name}
                  </th>
                  <td className="whitespace-nowrap py-3 pr-6">{share(r.fit_accepted, r.fit_decided)}</td>
                  <td className="whitespace-nowrap py-3 pr-6">{share(r.no_rejected, r.no_decided)}</td>
                  <td className="py-3">{r.rescued}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
