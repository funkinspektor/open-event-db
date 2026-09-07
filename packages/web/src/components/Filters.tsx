import Link from 'next/link'
import { RANGES, filtersToHref, type Filters as FilterState } from '@/lib/filters'

interface Props {
  filters: FilterState
  allTags: string[]
}

const pill = (active: boolean) =>
  `inline-flex items-center rounded-full border px-3 py-1 text-sm transition ${
    active
      ? 'border-neutral-900 bg-neutral-900 text-white'
      : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400'
  }`

export function Filters({ filters, allTags }: Props) {
  const toggleTag = (t: string) => {
    const tags = filters.tags.includes(t)
      ? filters.tags.filter((x) => x !== t)
      : [...filters.tags, t]
    return filtersToHref({ ...filters, tags })
  }

  const hasActive = filters.range !== 'upcoming' || filters.tags.length > 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${pill(true)} cursor-default`} title="More cities coming soon">
          {filters.city}
        </span>
        <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden />
        {RANGES.map((r) => (
          <Link
            key={r.key}
            href={filtersToHref({ ...filters, range: r.key })}
            className={pill(filters.range === r.key)}
            aria-current={filters.range === r.key ? 'page' : undefined}
          >
            {r.label}
          </Link>
        ))}
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {allTags.map((t) => (
            <Link
              key={t}
              href={toggleTag(t)}
              className={pill(filters.tags.includes(t))}
              aria-pressed={filters.tags.includes(t)}
            >
              {t}
            </Link>
          ))}
          {hasActive && (
            <Link
              href="/"
              className="ml-1 text-sm text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline"
            >
              Clear
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
