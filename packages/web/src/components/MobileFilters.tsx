'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { RANGES, filtersToHref, type Filters } from '@/lib/filters'
import { dateRangeLabel } from './DateRangeFilter'
import { FilterIcon, PlusIcon } from './Icons'

/** "Upcoming", "This weekend", "16.10 – 19.10" — the tags show as a count next to it. */
function rangeLabel(f: Filters): string {
  return f.range === 'custom' ? dateRangeLabel(f) : (RANGES.find((r) => r.key === f.range)?.label ?? 'Upcoming')
}

// Phones only (CSS): the list toolbar — one filter button and Create event — sticking under the header.
// The button opens a bottom sheet with date range and tags; like the desktop popovers, nothing changes until "Show events".
export function MobileFilters({ filters, allTags }: { filters: Filters; allTags: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(filters)
  const [stuck, setStuck] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const active = filters.range !== 'upcoming' || filters.tags.length > 0
  const label = rangeLabel(filters)
  const tagCount = filters.tags.length

  // Hairline under the toolbar only once it sticks under the header.
  useEffect(() => {
    const onScroll = () => {
      const el = barRef.current
      if (!el || !el.offsetParent) return
      setStuck(window.scrollY > 0 && el.getBoundingClientRect().top <= parseFloat(getComputedStyle(el).top) + 0.5)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const overflow = root.style.overflow
    root.style.overflow = 'hidden'
    sheetRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      root.style.overflow = overflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function apply() {
    setOpen(false)
    const next = draft.range === 'custom' && !draft.from && !draft.to ? { ...draft, range: 'upcoming' as const } : draft
    router.push(filtersToHref(next))
  }

  // Tags that are filtered on but no longer in the tag list stay visible so they can be removed.
  const tags = [...allTags, ...filters.tags.filter((t) => !allTags.includes(t))]
  const toggleTag = (t: string) =>
    setDraft({ ...draft, tags: draft.tags.includes(t) ? draft.tags.filter((x) => x !== t) : [...draft.tags, t] })

  return (
    <>
      <div ref={barRef} className={`kk-toolbar${stuck ? ' kk-toolbar--stuck' : ''}`}>
        <button
          ref={triggerRef}
          type="button"
          className="kk-filterbtn"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-pressed={active || undefined}
          aria-label={`Filters: ${label}${tagCount ? `, ${tagCount} tag${tagCount === 1 ? '' : 's'}` : ''}`}
          onClick={() => {
            setDraft(filters)
            setOpen(true)
          }}
        >
          <FilterIcon />
          <span className="kk-filterbtn__text">{label}</span>
          {tagCount > 0 && <span className="kk-pill__count">{tagCount}</span>}
        </button>
        <Link href="/events/new" className="kk-btn kk-btn--outline">
          <PlusIcon />
          Create event
        </Link>
      </div>

      {open &&
        createPortal(
          <>
            <div className="kk-scrim" onClick={close} />
            <div
              ref={sheetRef}
              className="kk-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="kk-sheet-title"
              tabIndex={-1}
            >
              <span className="kk-sheet__grip" aria-hidden />
              <div className="kk-sheet__head">
                <h2 id="kk-sheet-title" className="kk-sheet__title">
                  Filter events
                </h2>
                <button
                  type="button"
                  className="kk-btn kk-btn--text"
                  onClick={() => setDraft({ ...draft, range: 'upcoming', from: undefined, to: undefined, tags: [] })}
                >
                  Reset
                </button>
              </div>

              <section className="kk-sheet__section" aria-labelledby="kk-sheet-when">
                <span id="kk-sheet-when" className="kk-sheet__label">
                  When
                </span>
                <div className="kk-pills">
                  {RANGES.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      className="kk-pill"
                      aria-pressed={draft.range === r.key}
                      onClick={() => setDraft({ ...draft, range: r.key, from: undefined, to: undefined })}
                    >
                      {r.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="kk-pill"
                    aria-pressed={draft.range === 'custom'}
                    onClick={() => setDraft({ ...draft, range: 'custom' })}
                  >
                    Pick dates
                  </button>
                </div>
                {draft.range === 'custom' && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="kk-field">
                      From
                      <input
                        type="date"
                        value={draft.from ?? ''}
                        max={draft.to || undefined}
                        onChange={(e) => setDraft({ ...draft, from: e.target.value || undefined })}
                        className="kk-input"
                      />
                    </label>
                    <label className="kk-field">
                      Until
                      <input
                        type="date"
                        value={draft.to ?? ''}
                        min={draft.from || undefined}
                        onChange={(e) => setDraft({ ...draft, to: e.target.value || undefined })}
                        className="kk-input"
                      />
                    </label>
                  </div>
                )}
              </section>

              {tags.length > 0 && (
                <section className="kk-sheet__section" aria-labelledby="kk-sheet-tags">
                  <span id="kk-sheet-tags" className="kk-sheet__label">
                    Tags
                  </span>
                  <div className="kk-pills" style={{ gap: 6 }}>
                    {tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="kk-tag kk-tag--filter"
                        aria-pressed={draft.tags.includes(t)}
                        onClick={() => toggleTag(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <div className="kk-sheet__foot">
                <button type="button" className="kk-btn kk-btn--primary w-full" onClick={apply}>
                  Show events
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  )
}
