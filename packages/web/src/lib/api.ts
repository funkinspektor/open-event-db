import type {
  EventDetail,
  EventSlim,
  IngestItemDetail,
  IngestItemView,
  IngestSourceCount,
  Meta,
  PublisherMe,
  PublisherPublic,
  Venue,
} from '@open-event-db/shared'

export const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// Server-side only: exempts page rendering from the API's per-IP rate limit (see API_INTERNAL_TOKEN).
const INTERNAL_HEADERS: Record<string, string> = process.env.API_INTERNAL_TOKEN
  ? { 'x-internal-token': process.env.API_INTERNAL_TOKEN }
  : {}

export const ALL_STATUSES = 'scheduled,postponed,cancelled'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: string) => UUID_RE.test(s)

async function get<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store', headers: INTERNAL_HEADERS })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`)
  return (await res.json()) as T
}

export interface EventListResponse {
  data: EventSlim[]
  meta: Meta
}

export async function getEvents(params: URLSearchParams): Promise<EventListResponse> {
  const res = await get<EventListResponse>(`/api/v1/events?${params.toString()}`)
  return res ?? { data: [], meta: { cursor: null, has_more: false } }
}

export async function getEvent(id: string): Promise<EventDetail | null> {
  const res = await get<{ data: EventDetail }>(`/api/v1/events/${id}`)
  return res?.data ?? null
}

export async function getVenue(id: string): Promise<Venue | null> {
  const res = await get<{ data: Venue }>(`/api/v1/venues/${id}`)
  return res?.data ?? null
}

export async function getVenues(params: URLSearchParams): Promise<{ data: Venue[]; meta: Meta }> {
  const res = await get<{ data: Venue[]; meta: Meta }>(`/api/v1/venues?${params.toString()}`)
  return res ?? { data: [], meta: { cursor: null, has_more: false } }
}

export async function getPublisher(slug: string): Promise<PublisherPublic | null> {
  const res = await get<{ data: PublisherPublic }>(`/api/v1/publishers/${slug}`)
  return res?.data ?? null
}

export async function getTags(): Promise<string[]> {
  const res = await get<{ data: string[] }>('/api/v1/tags')
  return res?.data ?? []
}

export async function getMe(cookieHeader: string): Promise<PublisherMe | null> {
  const res = await fetch(`${API_URL}/api/v1/auth/me`, {
    headers: { ...INTERNAL_HEADERS, cookie: cookieHeader },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return ((await res.json()) as { data: PublisherMe }).data
}

async function getScout<T>(path: string, cookieHeader: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    headers: { ...INTERNAL_HEADERS, cookie: cookieHeader },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`)
  return (await res.json()) as T
}

export interface IngestCounts {
  new: number
  gone: number
}

export type IngestView = 'new' | 'gone'

export interface IngestPageMeta {
  cursor: string | null
  has_more: boolean
  /** Counts of the listed source when one is given, of all sources otherwise. */
  counts: IngestCounts
  /** Every source with items in the view, for the source filter. */
  sources: IngestSourceCount[]
}

export async function getIngestItems(
  query: { view: IngestView; source?: string; cursor?: string; limit: number },
  cookieHeader: string,
): Promise<{ data: IngestItemView[]; meta: IngestPageMeta }> {
  const params = new URLSearchParams({ view: query.view, limit: String(query.limit) })
  if (query.source) params.set('source', query.source)
  if (query.cursor) params.set('cursor', query.cursor)
  return getScout(`/ingest/items?${params}`, cookieHeader)
}

export async function getIngestCount(cookieHeader: string): Promise<IngestCounts> {
  return (await getScout<{ data: IngestCounts }>('/ingest/count', cookieHeader)).data
}

/** One inbox item with its state; null for an unknown item. */
export async function getIngestItem(id: string, cookieHeader: string): Promise<IngestItemDetail | null> {
  const res = await fetch(`${API_URL}/api/v1/ingest/items/${id}`, {
    headers: { ...INTERNAL_HEADERS, cookie: cookieHeader },
    cache: 'no-store',
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`API ${res.status} for /ingest/items/${id}`)
  return ((await res.json()) as { data: IngestItemDetail }).data
}
