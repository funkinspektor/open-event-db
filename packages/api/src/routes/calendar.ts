import type { FastifyInstance } from 'fastify'
import { and, asc, eq, gte } from 'drizzle-orm'
import { accounts, eventInterests, events, venues } from '@open-event-db/db'
import { db } from '../db.js'
import { notFound } from '../errors.js'
import { stripMarkdown, toICalendar, type CalendarEvent } from '../ical.js'

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000'
const WINDOW_MS = 90 * 86_400_000
const SUFFIX = '.ics'

const tokenOf = (file: string) => (file.endsWith(SUFFIX) ? file.slice(0, -SUFFIX.length) : '')

function location(e: {
  venueName: string | null
  venueAddress: string | null
  venueCity: string | null
  locationText: string | null
  city: string
}) {
  if (e.venueName) return [e.venueName, e.venueAddress, e.venueCity].filter(Boolean).join(', ')
  if (e.locationText) return [e.locationText, e.city].filter(Boolean).join(', ')
  return null
}

/** Subscribable feed of an account's marked events. The secret token in the path is the credential. */
export async function calendarRoutes(app: FastifyInstance) {
  app.get<{ Params: { file: string } }>(
    '/cal/:file',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 hour',
          keyGenerator: (req) => `cal:${tokenOf((req.params as { file: string }).file)}`,
        },
      },
    },
    async (req, reply) => {
      const token = tokenOf(req.params.file)
      if (!token) throw notFound()
      const [account] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.calendarToken, token))
      if (!account) throw notFound()

      const now = new Date()
      const rows = await db
        .select({
          id: events.id,
          title: events.title,
          description: events.description,
          startsAt: events.startsAt,
          startTimeKnown: events.startTimeKnown,
          endsAt: events.endsAt,
          status: events.status,
          city: events.city,
          locationText: events.locationText,
          venueName: venues.name,
          venueAddress: venues.address,
          venueCity: venues.city,
          createdAt: events.createdAt,
          updatedAt: events.updatedAt,
        })
        .from(eventInterests)
        .innerJoin(events, eq(events.id, eventInterests.eventId))
        .leftJoin(venues, eq(venues.id, events.venueId))
        .where(and(eq(eventInterests.accountId, account.id), gte(events.startsAt, new Date(now.getTime() - WINDOW_MS))))
        .orderBy(asc(events.startsAt))

      const list: CalendarEvent[] = rows.map((r) => ({
        id: r.id,
        title: r.title,
        descriptionPlain: stripMarkdown(r.description ?? ''),
        startsAt: r.startsAt,
        startTimeKnown: r.startTimeKnown,
        endsAt: r.endsAt,
        status: r.status,
        location: location(r),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }))
      return reply
        .type('text/calendar; charset=utf-8')
        .header('cache-control', 'private, max-age=300')
        .send(toICalendar(list, { now, webUrl: WEB_URL }))
    },
  )
}
