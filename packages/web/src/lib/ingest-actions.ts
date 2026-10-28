const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export type IngestActionResult<T> = { data: T } | { error: string; status: number }

/** A scout's inbox decision (`items/<id>/accept`, `items/reject`, …), sent from the browser with the session cookie. */
export async function ingestAction<T>(path: string, body: unknown): Promise<IngestActionResult<T>> {
  try {
    const res = await fetch(`${API_URL}/api/v1/ingest/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { message: string } }
    if (!res.ok || !json.data) return { error: json.error?.message ?? `Request failed (${res.status})`, status: res.status }
    return { data: json.data }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Request failed', status: 0 }
  }
}
