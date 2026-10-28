import { z } from 'zod'
import { cursorQuerySchema, metaSchema } from './pagination.js'
import { linksSchema } from './links.js'

/** Largest event image the API stores, uploaded or fetched from a feed. */
export const EVENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024

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
  /** Events owned by this publisher (creator or co-owner). */
  publisher_id: z.string().uuid().optional(),
  /** Events added by this account (`created_by`), whether claimed or not. */
  added_by: z.string().uuid().optional(),
  status: csvOrArray(eventStatusSchema),
  q: z.string().min(1).optional(),
  /** Sort by start time: `asc` (soonest first, default) or `desc` (newest first, e.g. for past events). */
  order: z.enum(['asc', 'desc']).default('asc'),
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
  image_url: z.string().url().nullable(),
  /** False while the event has no owner (added by a scout, not yet confirmed by the organizer). */
  claimed: z.boolean(),
})

export type EventSlim = z.infer<typeof eventSlimSchema>

export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

export type Coordinates = z.infer<typeof coordinatesSchema>

export const venueDetailEmbedSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  coordinates: coordinatesSchema.nullable(),
})

export const eventOwnerRoleSchema = z.enum(['creator', 'co_owner'])
export type EventOwnerRole = z.infer<typeof eventOwnerRoleSchema>

export const eventOwnerSchema = z.object({
  publisher_id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  role: eventOwnerRoleSchema,
})

/** Who added the event. Immutable, survives a claim. */
export const eventAddedBySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  is_scout: z.boolean(),
})

export type EventAddedBy = z.infer<typeof eventAddedBySchema>

export const eventDetailSchema = eventSlimSchema
  .omit({ venue: true })
  .extend({
    links: linksSchema,
    added_by: eventAddedBySchema,
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    venue: venueDetailEmbedSchema.nullable(),
    owners: z.array(eventOwnerSchema),
    /** Set while a feed keeps this event in sync; editing detaches it. */
    synced_from: z.object({ source_name: z.string(), source_url: z.string().url().nullable() }).nullable(),
  })

export type EventDetail = z.infer<typeof eventDetailSchema>

export const eventListResponseSchema = z.object({
  data: z.array(eventSlimSchema),
  meta: metaSchema,
})

export const eventDetailResponseSchema = z.object({
  data: eventDetailSchema,
})

export const eventCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }).nullable().optional(),
  description: z.string().max(10_000).optional(),
  venue_id: z.string().uuid().nullable().optional(),
  location_text: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().min(1).max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  links: linksSchema.optional(),
  recurrence: z.string().trim().max(200).nullable().optional(),
})

export type EventCreateInput = z.infer<typeof eventCreateSchema>

export const eventUpdateSchema = eventCreateSchema.partial().extend({
  status: eventStatusSchema.optional(),
})

export type EventUpdateInput = z.infer<typeof eventUpdateSchema>

export const addOwnerSchema = z.object({
  publisher_id: z.string().uuid(),
})
