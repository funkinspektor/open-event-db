import { linkLabel } from '@/lib/format'
import { ExtIcon } from './Icons'

// Outbound links as pill buttons with ↗. `primary` names the one link that gets the chrome fill (Tickets).
export function LinkButtons({ links, primary }: { links: Record<string, string>; primary?: string }) {
  const entries = Object.entries(links)
  if (entries.length === 0) return null
  const sorted = primary ? [...entries].sort(([a], [b]) => Number(b === primary) - Number(a === primary)) : entries
  return (
    <ul className="kk-pills m-0 list-none p-0">
      {sorted.map(([key, href]) => (
        <li key={key}>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className={`kk-btn ${key === primary ? 'kk-btn--primary' : 'kk-btn--secondary'}`}
          >
            {linkLabel(key)}
            <ExtIcon />
          </a>
        </li>
      ))}
    </ul>
  )
}
