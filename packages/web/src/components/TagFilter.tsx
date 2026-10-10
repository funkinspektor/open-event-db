'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { filtersToHref, type Filters } from '@/lib/filters'
import { ChevronIcon } from './Icons'

// Tags live behind a pill with a popover so the filter bar stays one row.
// Selection is local until "Show events"; closing without applying resets it.
export function TagFilter({ filters, allTags }: { filters: Filters; allTags: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(filters.tags)
  const ref = useRef<HTMLDivElement>(null)
  const applied = filters.tags.join(',')

  useEffect(() => setSel(filters.tags), [applied]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const dismiss = () => {
      setOpen(false)
      setSel(filters.tags)
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) dismiss()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      dismiss()
      ref.current?.querySelector('button')?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, applied]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tags that are filtered on but no longer in the tag list stay visible so they can be removed.
  const tags = [...allTags, ...filters.tags.filter((t) => !allTags.includes(t))]
  const count = open ? sel.length : filters.tags.length

  return (
    <div ref={ref} className="kk-dropdown">
      <button
        type="button"
        className="kk-pill"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          if (open) setSel(filters.tags)
          setOpen(!open)
        }}
      >
        Tags
        {count > 0 && <span className="kk-pill__count">{count}</span>}
        <ChevronIcon className="kk-icon kk-pill__chev" />
      </button>
      {open && (
        <div className="kk-popover" role="dialog" aria-label="Filter by tags">
          <div className="kk-pills" style={{ gap: 6 }}>
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className="kk-tag kk-tag--filter"
                aria-pressed={sel.includes(t)}
                onClick={() => setSel(sel.includes(t) ? sel.filter((x) => x !== t) : [...sel, t])}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="kk-popover__foot">
            <button type="button" className="kk-btn kk-btn--text" onClick={() => setSel([])}>
              Clear
            </button>
            <button
              type="button"
              className="kk-btn kk-btn--primary"
              onClick={() => {
                setOpen(false)
                router.push(filtersToHref({ ...filters, tags: sel }))
              }}
            >
              Show events
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
