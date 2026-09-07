import type {
  EventDetail,
  EventSlim,
  Meta,
  PublisherMe,
  PublisherPublic,
  Venue,
} from '@open-event-db/shared'

export const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export const ALL_STATUSES = 'scheduled,postponed,cancelled'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: string) => UUID_RE.test(s)

async function get<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' })
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

export async function getPublisher(slug: string): Promise<PublisherPublic | null> {
  const res = await get<{ data: PublisherPublic }>(`/api/v1/publishers/${slug}`)
  return res?.data ?? null
}

export async function getTags(): Promise<string[]> {
  const res = await get<{ data: string[] }>('/api/v1/tags')
  return res?.data ?? []
}

export async function getVenues(): Promise<Venue[]> {
  const res = await get<{ data: Venue[] }>('/api/v1/venues?limit=100')
  return res?.data ?? []
}

export async function getMe(cookieHeader: string): Promise<PublisherMe | null> {
  const res = await fetch(`${API_URL}/api/v1/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return ((await res.json()) as { data: PublisherMe }).data
}
