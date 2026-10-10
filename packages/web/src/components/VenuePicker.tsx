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
  inputClassName: string
}

const label = 'block text-sm font-medium text-neutral-800'

export function VenuePicker({ value, onChange, onCreatingChange, inputClassName }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<VenueOption[]>([])
  const [open, setOpen] = useState(false)
  const [creating, setCreatingState] = useState(false)
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
      <div className={label}>
        Venue
        <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm">
          <span className="truncate font-normal">
            {value.name} <span className="text-neutral-500">· {value.city}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setQuery('')
            }}
            className="shrink-0 text-sm font-normal text-neutral-600 underline-offset-2 hover:underline"
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
        inputClassName={inputClassName}
        onCancel={() => setCreating(false)}
        onSaved={(venue) => {
          setCreating(false)
          onChange({ id: venue.id, name: venue.name, city: venue.city })
        }}
      />
    )
  }

  return (
    <div ref={boxRef} className="relative">
      <label className={label}>
        Venue <span className="font-normal text-neutral-500">(optional)</span>
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
          className={inputClassName}
        />
      </label>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg"
        >
          {results.map((v) => (
            <li key={v.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  onChange({ id: v.id, name: v.name, city: v.city })
                  setOpen(false)
                }}
                className="block w-full px-3 py-2 text-left hover:bg-neutral-50"
              >
                {v.name} <span className="text-neutral-500">· {v.city}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && query.trim() && (
            <li className="px-3 py-2 text-neutral-500">No venue matches “{query.trim()}”.</li>
          )}
          <li role="option" aria-selected={false} className="border-t border-neutral-100">
            <button
              type="button"
              onClick={() => {
                setCreating(true)
                setOpen(false)
              }}
              className="block w-full px-3 py-2 text-left font-medium text-violet-700 hover:bg-neutral-50"
            >
              + Create new venue{query.trim() ? ` “${query.trim()}”` : ''}
            </button>
          </li>
        </ul>
      )}
      <span className="mt-1 block text-xs text-neutral-500">Leave empty to describe the location in text instead.</span>
    </div>
  )
}
