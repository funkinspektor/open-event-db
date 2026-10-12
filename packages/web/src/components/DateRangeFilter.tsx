'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { filtersToHref, type Filters } from '@/lib/filters'
import { ChevronIcon } from './Icons'

// Same DD.MM style as the day headings in the listing.
const fmt = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`

/** "16.10 – 19.10", "From 16.10", "Until 19.10" */
function label(f: Filters): string {
  if (f.from && f.to) return f.from === f.to ? fmt(f.from) : `${fmt(f.from)} – ${fmt(f.to)}`
  if (f.from) return `From ${fmt(f.from)}`
  if (f.to) return `Until ${fmt(f.to)}`
  return 'Dates'
}

// Custom date range next to the preset ranges. Like the tag filter, nothing changes until "Show events".
export function DateRangeFilter({ filters }: { filters: Filters }) {
  const router = useRouter()
  const active = filters.range === 'custom'
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(filters.from ?? '')
  const [to, setTo] = useState(filters.to ?? '')
  const ref = useRef<HTMLDivElement>(null)
  const applied = `${filters.from ?? ''}|${filters.to ?? ''}`

  const reset = () => {
    setFrom(filters.from ?? '')
    setTo(filters.to ?? '')
  }

  useEffect(reset, [applied]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const dismiss = () => {
      setOpen(false)
      reset()
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

  function apply(e: React.FormEvent) {
    e.preventDefault()
    setOpen(false)
    if (!from && !to) {
      router.push(filtersToHref({ ...filters, range: 'upcoming' }))
      return
    }
    router.push(filtersToHref({ ...filters, range: 'custom', from: from || undefined, to: to || undefined }))
  }

  return (
    <div ref={ref} className="kk-dropdown">
      <button
        type="button"
        className="kk-pill"
        aria-haspopup="true"
        aria-expanded={open}
        aria-pressed={active && !open ? true : undefined}
        onClick={() => {
          if (open) reset()
          setOpen(!open)
        }}
      >
        {active ? label(filters) : 'Dates'}
        <ChevronIcon className="kk-icon kk-pill__chev" />
      </button>
      {open && (
        <form className="kk-popover" role="dialog" aria-label="Filter by dates" onSubmit={apply}>
          <div className="grid grid-cols-2 gap-3">
            <label className="kk-field">
              From
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="kk-input"
              />
            </label>
            <label className="kk-field">
              Until
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="kk-input"
              />
            </label>
          </div>
          <span className="kk-hint">Both days included. Leave one empty for an open range.</span>
          <div className="kk-popover__foot">
            <button
              type="button"
              className="kk-btn kk-btn--text"
              onClick={() => {
                setFrom('')
                setTo('')
              }}
            >
              Clear
            </button>
            <button type="submit" className="kk-btn kk-btn--primary">
              Show events
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
