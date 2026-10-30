'use client'

import { useRouter } from 'next/navigation'
import type { IngestSourceCount } from '@open-event-db/shared'

interface Props {
  sources: IngestSourceCount[]
  /** The listed source's slug, if one is chosen. */
  value: string | undefined
  /** Items of all sources in the view. */
  total: number
  /** The inbox URL for a source (undefined: all sources); starts again at the first page. */
  hrefs: Record<string, string>
  allHref: string
}

/** Narrows the inbox to one source; choosing one navigates right away. */
export function IngestSourceFilter({ sources, value, total, hrefs, allHref }: Props) {
  const router = useRouter()
  // A source whose items were all decided drops out of the counts but stays chosen
  const options = value && !sources.some((s) => s.slug === value) ? [...sources, { slug: value, name: value, count: 0 }] : sources

  return (
    <label className="kk-field max-w-[420px]">
      Source
      <select
        value={value ?? ''}
        onChange={(e) => router.push(e.target.value ? (hrefs[e.target.value] ?? allHref) : allHref)}
        className="kk-input"
      >
        <option value="">All sources ({total})</option>
        {options.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name} ({s.count})
          </option>
        ))}
      </select>
    </label>
  )
}
