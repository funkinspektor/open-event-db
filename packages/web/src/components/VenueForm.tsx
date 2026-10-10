'use client'

import { useEffect, useRef, useState } from 'react'
import type { Coordinates, Venue } from '@open-event-db/shared'
import { Map } from './Map'
import { LinksEditor, fromLinkRows, toLinkRows, type LinkRow } from './LinksEditor'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

const LINK_KEYS = ['website', 'instagram', 'ra', 'facebook', 'telegram']

interface Place {
  name: string
  address: string
  city: string
  kind: string | null
  label: string
  coordinates: Coordinates
}

interface NominatimRow {
  name?: string
  display_name: string
  type?: string
  lat: string
  lon: string
  address?: Record<string, string>
}

function toPlace(r: NominatimRow): Place {
  const a = r.address ?? {}
  const street = a.road ?? a.pedestrian ?? a.square ?? a.footway ?? a.place ?? ''
  const address = [street, a.house_number].filter(Boolean).join(' ')
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? ''
  const name = r.name?.trim() ?? ''
  const label = [address, [a.postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return {
    name,
    address,
    city,
    kind: r.type && r.type !== 'yes' ? r.type.replace(/_/g, ' ') : null,
    label: label || r.display_name,
    coordinates: { lat: Number(r.lat), lng: Number(r.lon) },
  }
}

const label = 'block text-sm font-medium text-neutral-800'

interface Props {
  /** Edit an existing venue; omit to create a new one. */
  venue?: Venue
  /** Pre-filled name for a new venue — triggers an immediate map search. */
  initialName?: string
  inputClassName: string
  onCancel: () => void
  onSaved: (venue: Venue) => void
  /** Render as a nested box inside another form (event form) instead of a standalone card. */
  nested?: boolean
}

export function VenueForm({ venue, initialName = '', inputClassName, onCancel, onSaved, nested }: Props) {
  const editing = !!venue
  const [name, setName] = useState(venue?.name ?? initialName)
  const [city, setCity] = useState(venue?.city ?? 'Berlin')
  const [address, setAddress] = useState(venue?.address ?? '')
  const [links, setLinks] = useState<LinkRow[]>(toLinkRows(venue?.links))
  const [byAddress, setByAddress] = useState(false)
  const [places, setPlaces] = useState<Place[] | null>(null)
  const [coordinates, setCoordinates] = useState<Coordinates | null>(venue?.coordinates ?? null)
  const [picked, setPicked] = useState<Place | null>(null)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Nominatim's usage policy: max 1 request/second, no search-as-you-type.
  // Lookups only happen on an explicit action and the button stays disabled while one runs.
  async function search(term = byAddress ? address : name) {
    if (!term.trim() || !city.trim() || searching) return
    setError(null)
    setPlaces(null)
    setPicked(null)
    setSearching(true)
    try {
      const params = new URLSearchParams({
        q: `${term.trim()}, ${city.trim()}`,
        format: 'jsonv2',
        addressdetails: '1',
        limit: '6',
      })
      const res = await fetch(`${NOMINATIM_URL}?${params}`, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`Map search failed (${res.status})`)
      const found = ((await res.json()) as NominatimRow[]).map(toPlace)
      setPlaces(found)
      if (found.length === 1) pick(found[0]!)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Map search failed')
    } finally {
      // keep the button disabled a moment longer to stay under 1 req/s
      setTimeout(() => setSearching(false), 1000)
    }
  }

  function pick(place: Place) {
    setPicked(place)
    setCoordinates(place.coordinates)
    // When editing, the stored name wins — the map search only relocates the venue.
    if (!editing && place.name && (!byAddress || !name.trim())) setName(place.name)
    if (place.address) setAddress(place.address)
    if (place.city) setCity(place.city)
  }

  // Coming from "+ Create new venue “Berghain”": the click is the explicit action, search right away.
  // The ref guard keeps React's dev-mode double effect from sending two requests.
  const autoSearched = useRef(false)
  useEffect(() => {
    if (editing || autoSearched.current || !initialName.trim()) return
    autoSearched.current = true
    search(initialName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    if (!coordinates) return
    setError(null)
    setSaving(true)
    try {
      const body = { name, address, city, coordinates, ...(editing ? { links: fromLinkRows(links) } : {}) }
      const res = await fetch(editing ? `${API_URL}/api/v1/venues/${venue.id}` : `${API_URL}/api/v1/venues`, {
        method: editing ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { data?: Venue; error?: { message: string } }
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? `Request failed (${res.status})`)
        return
      }
      onSaved(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSaving(false)
    }
  }

  const term = byAddress ? address : name
  // A new venue needs a map pick; an existing one already has its location.
  const located = editing ? !!coordinates : !!picked
  const showDetails = editing || !!picked

  return (
    <fieldset
      // Enter inside the venue form must not submit a surrounding form
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || (e.target as HTMLElement).tagName !== 'INPUT') return
        e.preventDefault()
        const inSearchRow = (e.target as HTMLElement).closest('[data-search-row]')
        if (inSearchRow && (!picked || editing)) search(editing ? address : undefined)
      }}
      className={
        nested
          ? 'space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-4'
          : 'space-y-4 rounded-xl border border-neutral-200 bg-white p-6'
      }
    >
      {nested && <legend className="px-1 text-sm font-medium text-neutral-800">New venue</legend>}

      {editing && (
        <label className={label}>
          Venue name
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
        </label>
      )}

      <div className="space-y-3">
        {editing && <p className="text-sm font-medium text-neutral-800">Location</p>}
        <div data-search-row className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          {byAddress || editing ? (
            <label className={label}>
              Address
              <input
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value)
                  if (!editing) setPicked(null)
                }}
                placeholder="Street and number"
                className={inputClassName}
              />
            </label>
          ) : (
            <label className={label}>
              Venue name
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setPicked(null)
                }}
                placeholder="e.g. Berghain"
                className={inputClassName}
              />
              {picked && (
                <span className="mt-1 block text-xs font-normal text-neutral-500">
                  Name from OpenStreetMap — adjust it if the venue is known differently.
                </span>
              )}
            </label>
          )}
          <label className={label}>
            City
            <input
              value={city}
              onChange={(e) => {
                setCity(e.target.value)
                if (!editing) setPicked(null)
              }}
              className={inputClassName}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => search(editing && !byAddress ? address : undefined)}
            disabled={!(editing ? address : term).trim() || !city.trim() || searching}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
          >
            {searching ? 'Searching…' : editing ? 'Find address on map' : 'Search map'}
          </button>
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setByAddress(!byAddress)
                setPlaces(null)
                setPicked(null)
              }}
              className="text-sm text-neutral-600 underline-offset-2 hover:underline"
            >
              {byAddress ? 'Search by venue name instead' : 'Search by address instead'}
            </button>
          )}
          {editing && (
            <span className="text-xs text-neutral-500">Only needed if the pin on the map is wrong.</span>
          )}
        </div>
      </div>

      {places && places.length === 0 && (
        <p className="text-sm text-neutral-600">
          {byAddress || editing
            ? 'No location found. Check the spelling or leave out extras like “Hinterhof”.'
            : 'Not on the map under this name. Try another spelling or search by address instead.'}
        </p>
      )}

      {places && places.length > 1 && (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-md border border-neutral-200 bg-white">
          {places.map((p, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => pick(p)}
                aria-pressed={picked === p}
                className={`block w-full border-l-4 px-3 py-2 text-left text-sm ${picked === p ? 'border-violet-600 bg-violet-50' : 'border-transparent hover:bg-neutral-50'}`}
              >
                <span className="font-medium">{p.name || p.label}</span>
                {p.kind && <span className="ml-2 text-xs text-neutral-500">{p.kind}</span>}
                {p.name && <span className="block text-neutral-600">{p.label}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {showDetails && coordinates && (
        <Map lat={coordinates.lat} lng={coordinates.lng} title={name || 'venue'} />
      )}

      {picked && !editing && (
        <div className="space-y-3">
          {byAddress ? (
            <label className={label}>
              Venue name
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
            </label>
          ) : (
            <label className={label}>
              Address
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street and number"
                className={inputClassName}
              />
              <span className="mt-1 block text-xs font-normal text-neutral-500">
                {picked.address
                  ? 'Filled in from the map — fix it if needed.'
                  : 'The map has no street for this place — please add it.'}
              </span>
            </label>
          )}
        </div>
      )}

      {editing && (
        <div>
          <span className={label}>Links</span>
          <LinksEditor rows={links} onChange={setLinks} suggestedKeys={LINK_KEYS} inputClassName={inputClassName} />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!located || !name.trim() || !address.trim() || !city.trim() || saving}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save venue'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-neutral-600 hover:text-neutral-900">
          Cancel
        </button>
      </div>
    </fieldset>
  )
}
