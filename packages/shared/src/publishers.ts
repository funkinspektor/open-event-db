import { z } from 'zod'
import { cursorQuerySchema, metaSchema } from './pagination.js'
import { linksSchema } from './links.js'

export const publisherListQuerySchema = cursorQuerySchema.extend({
  q: z.string().min(1).optional(),
})

export type PublisherListQuery = z.infer<typeof publisherListQuerySchema>

export const publisherPublicSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  links: linksSchema,
  verified: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
})

export type PublisherPublic = z.infer<typeof publisherPublicSchema>

export const publisherListResponseSchema = z.object({
  data: z.array(publisherPublicSchema),
  meta: metaSchema,
})

export const checkSlugQuerySchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'invalid slug format'),
})

export const checkSlugResponseSchema = z.object({
  data: z.object({ available: z.boolean() }),
})
