import type { Metadata } from 'next'
import Link from 'next/link'
import { getVenues } from '@/lib/api'

export const metadata: Metadata = {
  title: 'Venues',
  description: 'Clubs, bars and spaces in the Open Event Database.',
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function VenuesPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).q
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? ''

  const params = new URLSearchParams({ limit: '100' })
  if (q) params.set('q', q)
  const { data: venues, meta } = await getVenues(params)

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Venues</h1>
        <p className="max-w-prose text-neutral-600">
          Clubs, bars and spaces with events in the database. Maintained by the community.
        </p>
      </section>

      <form action="/venues" className="flex max-w-md gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search venues…"
          aria-label="Search venues"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
        />
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        >
          Search
        </button>
      </form>

      {venues.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
          {q ? `No venue matches “${q}”.` : 'No venues yet.'}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {venues.map((v) => (
            <li key={v.id}>
              <Link
                href={`/venues/${v.id}`}
                className="block rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300 hover:shadow-sm"
              >
                <span className="block font-semibold text-neutral-900">{v.name}</span>
                <span className="block text-sm text-neutral-600">
                  {v.address} · {v.city}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {meta.has_more && (
        <p className="text-sm text-neutral-500">Showing the first 100 venues — use the search to narrow it down.</p>
      )}
    </div>
  )
}
