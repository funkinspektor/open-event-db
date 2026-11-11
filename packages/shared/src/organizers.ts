import { z } from 'zod'
import { cursorQuerySchema, metaSchema } from './pagination.js'
import { linksSchema } from './links.js'
import { eventSlimSchema } from './events.js'

export const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'invalid slug format')

export const organizerListQuerySchema = cursorQuerySchema.extend({
  q: z.string().min(1).optional(),
})

export type OrganizerListQuery = z.infer<typeof organizerListQuerySchema>

export const organizerPublicSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  links: linksSchema,
  verified: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
})

export type OrganizerPublic = z.infer<typeof organizerPublicSchema>

export const organizerDetailSchema = organizerPublicSchema.extend({
  upcoming_events: z.array(eventSlimSchema),
})

export type OrganizerDetail = z.infer<typeof organizerDetailSchema>

export const organizerListResponseSchema = z.object({
  data: z.array(organizerPublicSchema),
  meta: metaSchema,
})

export const checkSlugQuerySchema = z.object({
  slug: slugSchema,
})

export const checkSlugResponseSchema = z.object({
  data: z.object({ available: z.boolean() }),
})

export const organizerUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: slugSchema,
    links: linksSchema,
  })
  .partial()

export type OrganizerUpdateInput = z.infer<typeof organizerUpdateSchema>
