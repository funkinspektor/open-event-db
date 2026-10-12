'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { Venue } from '@open-event-db/shared'
import { VenueForm } from './VenueForm'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export interface VenueOption {
  id: string
  name: string
  city: string
}

interface Props {
  value: VenueOption | null
  onChange: (venue: VenueOption | null) => void
  onCreatingChange?: (creating: boolean) => void
  /** Image import without a unique match: possible venues to pick from, or a new venue to create. */
  fromImage?: {
    name: string | null
    candidates: VenueOption[]
    create: { name: string; address: string; city: string } | null
  }
  /** Marks the empty search field after an import. */
  missing?: boolean
}

export function VenuePicker({ value, onChange, onCreatingChange, fromImage, missing }: Props) {
  const create = fromImage?.create ?? null
  const [query, setQuery] = useState(create?.name ?? '')
  const [results, setResults] = useState<VenueOption[]>([])
  const [open, setOpen] = useState(false)
  const [creating, setCreatingState] = useState(!!create)
  const setCreating = (next: boolean) => {
    setCreatingState(next)
    onCreatingChange?.(next)
  }
  const boxRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (value || creating) return
    const q = query.trim()
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: '8' })
        if (q) params.set('q', q)
        const res = await fetch(`${API_URL}/api/v1/venues?${params}`, { signal: ctrl.signal })
        if (!res.ok) return
        setResults(((await res.json()) as { data: Venue[] }).data)
      } catch {
        // aborted or offline — keep previous results
      }
    }, 200)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query, value, creating])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  if (value) {
    return (
      <div className="kk-field">
        Venue
        <div className="kk-selected">
          <span className="min-w-0">
            <span className="kk-selected__name">{value.name}</span>
            <span className="kk-selected__meta">{value.city}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setQuery('')
            }}
            className="kk-btn kk-btn--outline shrink-0"
          >
            Change
          </button>
        </div>
      </div>
    )
  }

  if (creating) {
    return (
      <VenueForm
        nested
        initialName={query.trim()}
        // The address read from the image only belongs to the name read with it
        initialAddress={create && query.trim() === create.name ? create.address : undefined}
        initialCity={create && query.trim() === create.name ? create.city : undefined}
        onCancel={() => setCreating(false)}
        onSaved={(venue) => {
          setCreating(false)
          onChange({ id: venue.id, name: venue.name, city: venue.city })
        }}
      />
    )
  }

  const candidates = fromImage?.candidates ?? []

  return (
    <div className="kk-field">
      {candidates.length > 0 && (
        <div className="kk-subpanel !gap-2">
          <span className="kk-hint">
            The image says “{fromImage?.name}”. Is it one of these?
          </span>
          <ul className="kk-options">
            {candidates.map((v) => (
              <li key={v.id}>
                <button type="button" onClick={() => onChange(v)} className="kk-option">
                  {v.name} <span className="kk-option__meta">· {v.city}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div ref={boxRef} className="relative">
        <label className="kk-field">
          <span>
            Venue <span className="kk-field__opt">(optional)</span>
          </span>
          <input
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter') e.preventDefault()
            }}
            placeholder="Search venues…"
            autoComplete="off"
            className={'kk-input' + (missing ? ' kk-input--missing' : '')}
          />
        </label>
        {open && (
          <ul id={listId} role="listbox" className="kk-listbox">
            {results.map((v) => (
              <li key={v.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ id: v.id, name: v.name, city: v.city })
                    setOpen(false)
                  }}
                  className="kk-option"
                >
                  {v.name} <span className="kk-option__meta">· {v.city}</span>
                </button>
              </li>
            ))}
            {results.length === 0 && query.trim() && (
              <li className="px-3 py-2.5 text-[15px] font-normal text-muted">No venue matches “{query.trim()}”.</li>
            )}
            <li role="option" aria-selected={false} className="mt-1 border-t border-line pt-1">
              <button
                type="button"
                onClick={() => {
                  setCreating(true)
                  setOpen(false)
                }}
                className="kk-option font-bold"
              >
                + Create new venue{query.trim() ? ` “${query.trim()}”` : ''}
              </button>
            </li>
          </ul>
        )}
      </div>
      <span className="kk-hint">Leave empty to describe the location in text instead.</span>
    </div>
  )
}
