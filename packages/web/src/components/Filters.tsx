import Link from 'next/link'
import { RANGES, filtersToHref, type Filters as FilterState } from '@/lib/filters'
import { DateRangeFilter } from './DateRangeFilter'
import { TagFilter } from './TagFilter'

interface Props {
  filters: FilterState
  allTags: string[]
}

// Filter bar: city · date range (presets + custom) · Tags dropdown.
export function Filters({ filters, allTags }: Props) {
  return (
    <section aria-label="Filters" className="relative z-[5]">
      <div className="kk-pills">
        <span className="kk-pill kk-pill--fixed" title="More cities coming soon">
          {filters.city}
        </span>
        <span className="kk-pills__sep" aria-hidden />
        {RANGES.map((r) => (
          <Link
            key={r.key}
            href={filtersToHref({ ...filters, range: r.key })}
            className="kk-pill"
            aria-current={filters.range === r.key ? 'page' : undefined}
          >
            {r.label}
          </Link>
        ))}
        <DateRangeFilter filters={filters} />
        {allTags.length > 0 && (
          <>
            <span className="kk-pills__sep" aria-hidden />
            <TagFilter filters={filters} allTags={allTags} />
          </>
        )}
      </div>
    </section>
  )
}
