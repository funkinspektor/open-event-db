import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db.js'
import { events } from '@open-event-db/db'

export async function tagsRoutes(app: FastifyInstance) {
  app.get('/tags', async () => {
    const rows = await db.execute<{ tag: string }>(
      sql`SELECT DISTINCT unnest(${events.tags}) AS tag FROM ${events} ORDER BY tag`,
    )
    return { data: rows.map((r) => r.tag) }
  })
}
