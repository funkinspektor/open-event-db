import type { FastifyReply } from 'fastify'

/** Adds names to the `Vary` header without dropping what is already there (CORS sets `Vary: Origin`). */
export function appendVary(reply: FastifyReply, ...names: string[]): void {
  const existing = reply.getHeader('vary')
  const current = (Array.isArray(existing) ? existing.join(',') : String(existing ?? ''))
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const seen = new Set(current.map((v) => v.toLowerCase()))
  if (seen.has('*')) return
  for (const name of names) {
    if (!seen.has(name.toLowerCase())) {
      current.push(name)
      seen.add(name.toLowerCase())
    }
  }
  reply.header('Vary', current.join(', '))
}

/** For responses that belong to one account: no shared cache may store them. */
export function markPrivate(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store')
}
