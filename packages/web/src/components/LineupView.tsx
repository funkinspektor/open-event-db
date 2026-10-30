'use client'

import { useState } from 'react'
import type { Lineup } from '@open-event-db/shared'

/**
 * The event page's lineup: one block per group (floor, "Live", "DJs"). On phones a lineup with several
 * groups shows one at a time behind pills; wider screens show them all.
 */
export function LineupView({ lineup }: { lineup: Lineup }) {
  const [selected, setSelected] = useState(0)
  const paged = lineup.length > 1

  return (
    <div className={paged ? 'kk-lineup kk-lineup--paged' : 'kk-lineup'}>
      {paged && (
        <div className="kk-pills kk-lineup__pills" role="group" aria-label="Lineup groups">
          {lineup.map((g, i) => (
            <button key={i} type="button" aria-pressed={i === selected} onClick={() => setSelected(i)} className="kk-tag kk-tag--filter">
              {g.name ?? `Part ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      {lineup.map((g, i) => {
        const timed = g.acts.some((a) => a.time)
        return (
          <div
            key={i}
            className={['kk-lineup__group', timed ? '' : 'kk-lineup__group--untimed', i === selected ? '' : 'kk-lineup__group--hidden']
              .filter(Boolean)
              .join(' ')}
          >
            {g.name && <h3 className="kk-lineup__name">{g.name}</h3>}
            <ul className="m-0 list-none p-0">
              {g.acts.map((a, j) => (
                <li key={j} className="kk-set">
                  {timed && <span className="kk-set__time">{a.time}</span>}
                  <span className="kk-set__act">
                    {a.name}
                    {a.live && <span className="kk-live">Live</span>}
                  </span>
                  {a.note && <span className="kk-set__note">{a.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
