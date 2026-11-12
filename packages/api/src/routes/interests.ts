import type { FastifyInstance } from 'fastify'
import { and, eq, gte, lt } from 'drizzle-orm'
import { z } from 'zod'
import { eventInterests, events } from '@open-event-db/db'
import { db } from '../db.js'
import { markPrivate } from '../headers.js'
import { currentAccount, requireAuth, requireOnboarded, writeRateLimit } from '../auth.js'
import { notFound } from '../errors.js'

const write = { onRequest: [requireAuth, requireOnboarded], config: { rateLimit: writeRateLimit } }

const rangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

async function requireEvent(id: string): Promise<void> {
  const [e] = await db.select({ id: events.id }).from(events).where(eq(events.id, id)).limit(1)
  if (!e) throw notFound('Event not found')
}

export async function interestRoutes(app: FastifyInstance) {
  app.put<{ Params: { id: string } }>('/events/:id/interest', write, async (req, reply) => {
    const me = currentAccount(req)
    try {
      await db
        .insert(eventInterests)
        .values({ accountId: me.id, eventId: req.params.id })
        .onConflictDoNothing()
    } catch (err) {
      // No event with this id (also when it is hard-deleted mid-request): the FK rejects the row
      const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code
      if (code === '23503') throw notFound('Event not found')
      throw err
    }
    return reply.code(204).send()
  })

  app.delete<{ Params: { id: string } }>('/events/:id/interest', write, async (req, reply) => {
    const me = currentAccount(req)
    await requireEvent(req.params.id)
    await db
      .delete(eventInterests)
      .where(and(eq(eventInterests.accountId, me.id), eq(eventInterests.eventId, req.params.id)))
    return reply.code(204).send()
  })

  app.get('/accounts/me/interests', { onRequest: requireAuth }, async (req, reply) => {
    markPrivate(reply)
    const me = currentAccount(req)
    const { from, to } = rangeSchema.parse(req.query)
    const conditions = [eq(eventInterests.accountId, me.id)]
    if (from) conditions.push(gte(events.startsAt, from))
    if (to) conditions.push(lt(events.startsAt, to))
    const rows = await db
      .select({ id: eventInterests.eventId })
      .from(eventInterests)
      .innerJoin(events, eq(events.id, eventInterests.eventId))
      .where(and(...conditions))
    return { data: { event_ids: rows.map((r) => r.id) } }
  })
}
