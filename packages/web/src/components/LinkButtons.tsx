import { linkLabel } from '@/lib/format'

export function LinkButtons({ links }: { links: Record<string, string> }) {
  const entries = Object.entries(links)
  if (entries.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-2">
      {entries.map(([key, href]) => (
        <li key={key}>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            {linkLabel(key)} <span aria-hidden>↗</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
