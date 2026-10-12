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

interface Props {
  /** Edit an existing venue; omit to create a new one. */
  venue?: Venue
  /** Pre-filled name for a new venue — triggers an immediate map search. */
  initialName?: string
  onCancel: () => void
  onSaved: (venue: Venue) => void
  /** Render as a nested box inside another form (event form) instead of a standalone card. */
  nested?: boolean
}

export function VenueForm({ venue, initialName = '', onCancel, onSaved, nested }: Props) {
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

  const sub = 'kk-field !text-[13px] !font-medium text-muted'

  return (
    <fieldset
      // Enter inside the venue form must not submit a surrounding form
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || (e.target as HTMLElement).tagName !== 'INPUT') return
        e.preventDefault()
        const inSearchRow = (e.target as HTMLElement).closest('[data-search-row]')
        if (inSearchRow && (!picked || editing)) search(editing ? address : undefined)
      }}
      className={nested ? 'kk-subpanel' : 'kk-panel m-0 min-w-0'}
    >
      {nested && <legend className="kk-eyebrow">New venue</legend>}

      {editing && (
        <label className="kk-field">
          Venue name
          <input required value={name} onChange={(e) => setName(e.target.value)} className="kk-input kk-input--title" />
        </label>
      )}

      <div className="kk-field">
        {editing && 'Location'}
        <div data-search-row className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
          {byAddress || editing ? (
            <label className={editing ? sub : 'kk-field'}>
              Address
              <input
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value)
                  if (!editing) setPicked(null)
                }}
                placeholder="Street and number"
                className="kk-input"
              />
            </label>
          ) : (
            <label className="kk-field">
              Venue name
              <input
                value={name}
                // After a map pick this field adjusts the name; "Search map" starts a new search.
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Berghain"
                className="kk-input"
              />
            </label>
          )}
          <label className={editing ? sub : 'kk-field'}>
            City
            <input
              value={city}
              onChange={(e) => {
                setCity(e.target.value)
                if (!editing) setPicked(null)
              }}
              className="kk-input"
            />
          </label>
        </div>
        {picked && !editing && !byAddress && (
          <span className="kk-hint">Name from OpenStreetMap — adjust it if the venue is known differently.</span>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={() => search(editing && !byAddress ? address : undefined)}
            disabled={!(editing ? address : term).trim() || !city.trim() || searching}
            className="kk-btn kk-btn--outline"
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
              className="kk-btn kk-btn--text"
            >
              {byAddress ? 'Search by venue name instead' : 'Search by address instead'}
            </button>
          )}
          {editing && <span className="kk-hint">Only needed if the pin on the map is wrong.</span>}
        </div>
      </div>

      {places && places.length === 0 && (
        <p className="m-0 text-[15px] text-muted">
          {byAddress || editing
            ? 'No location found. Check the spelling or leave out extras like “Hinterhof”.'
            : 'Not on the map under this name. Try another spelling or search by address instead.'}
        </p>
      )}

      {places && places.length > 1 && (
        <ul className="kk-options">
          {places.map((p, i) => (
            <li key={i}>
              <button type="button" onClick={() => pick(p)} aria-pressed={picked === p} className="kk-option">
                <span className="font-bold">{p.name || p.label}</span>
                {p.kind && <span className="kk-option__meta ml-2 text-[13px]">{p.kind}</span>}
                {p.name && <span className="kk-option__meta block">{p.label}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {showDetails && coordinates && (
        <Map lat={coordinates.lat} lng={coordinates.lng} title={name || 'venue'} height={240} />
      )}

      {picked && !editing &&
        (byAddress ? (
          <label className="kk-field">
            Venue name
            <input value={name} onChange={(e) => setName(e.target.value)} className="kk-input" />
          </label>
        ) : (
          <label className="kk-field">
            Address
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street and number"
              className="kk-input"
            />
            <span className="kk-hint">
              {picked.address
                ? 'Filled in from the map — fix it if needed.'
                : 'The map has no street for this place — please add it.'}
            </span>
          </label>
        ))}

      {editing && (
        <div className="kk-field">
          Links
          <LinksEditor rows={links} onChange={setLinks} suggestedKeys={LINK_KEYS} />
        </div>
      )}

      {error && <p className="kk-error">{error}</p>}

      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={save}
          disabled={!located || !name.trim() || !address.trim() || !city.trim() || saving}
          className={`kk-btn kk-btn--primary${nested ? '' : ' kk-btn--lg'}`}
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save venue'}
        </button>
        <button type="button" onClick={onCancel} className="kk-btn kk-btn--text">
          Cancel
        </button>
      </div>
    </fieldset>
  )
}
