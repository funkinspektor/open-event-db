import { z } from 'zod'
import { cursorQuerySchema, metaSchema } from './pagination.js'
import { linksSchema } from './links.js'

export const eventStatusSchema = z.enum(['scheduled', 'cancelled', 'postponed'])
export type EventStatus = z.infer<typeof eventStatusSchema>

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

const csvOrArray = <T extends z.ZodTypeAny>(item: T) =>
  z
    .union([z.string(), z.array(item)])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined
      if (Array.isArray(v)) return v
      return csv(v) as z.infer<T>[]
    })

export const eventListQuerySchema = cursorQuerySchema.extend({
  city: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  tags: csvOrArray(z.string().min(1)),
  venue_id: z.string().uuid().optional(),
  publisher_id: z.string().uuid().optional(),
  status: csvOrArray(eventStatusSchema),
  q: z.string().min(1).optional(),
})

export type EventListQuery = z.infer<typeof eventListQuerySchema>

export const venueSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  city: z.string(),
})

export const eventSlimSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }).nullable(),
  status: eventStatusSchema,
  tags: z.array(z.string()),
  city: z.string(),
  location_text: z.string().nullable(),
  recurrence: z.string().nullable(),
  venue: venueSummarySchema.nullable(),
})

export type EventSlim = z.infer<typeof eventSlimSchema>

export const coordinatesSchema = z.object({
  lat: z.number(),
  lng: z.number(),
})

export const venueDetailEmbedSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  coordinates: coordinatesSchema.nullable(),
})

export const eventOwnerSchema = z.object({
  publisher_id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  role: z.enum(['creator', 'co_owner']),
})

export const eventDetailSchema = eventSlimSchema
  .omit({ venue: true })
  .extend({
    links: linksSchema,
    created_by: z.string().uuid(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    venue: venueDetailEmbedSchema.nullable(),
    owners: z.array(eventOwnerSchema),
  })

export type EventDetail = z.infer<typeof eventDetailSchema>

export const eventListResponseSchema = z.object({
  data: z.array(eventSlimSchema),
  meta: metaSchema,
})

export const eventDetailResponseSchema = z.object({
  data: eventDetailSchema,
})
