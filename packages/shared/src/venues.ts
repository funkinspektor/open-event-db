import { z } from 'zod'
import { cursorQuerySchema, metaSchema } from './pagination.js'
import { linksSchema } from './links.js'
import { coordinatesSchema } from './events.js'

export const venueListQuerySchema = cursorQuerySchema.extend({
  city: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
})

export type VenueListQuery = z.infer<typeof venueListQuerySchema>

export const venueSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  coordinates: coordinatesSchema.nullable(),
  links: linksSchema,
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
})

export type Venue = z.infer<typeof venueSchema>

export const venueListResponseSchema = z.object({
  data: z.array(venueSchema),
  meta: metaSchema,
})

export const venueDetailResponseSchema = z.object({
  data: venueSchema,
})

export const venueCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(300),
  city: z.string().trim().min(1).max(100),
  coordinates: coordinatesSchema,
  links: linksSchema.optional(),
})

export type VenueCreateInput = z.infer<typeof venueCreateSchema>

export const venueUpdateSchema = venueCreateSchema.partial()

export type VenueUpdateInput = z.infer<typeof venueUpdateSchema>
