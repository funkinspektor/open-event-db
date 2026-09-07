import { z } from 'zod'
import { cursorQuerySchema, metaSchema } from './pagination.js'
import { linksSchema } from './links.js'

export const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'invalid slug format')

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
  slug: slugSchema,
})

export const checkSlugResponseSchema = z.object({
  data: z.object({ available: z.boolean() }),
})

export const publisherUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: slugSchema,
    links: linksSchema,
  })
  .partial()

export type PublisherUpdateInput = z.infer<typeof publisherUpdateSchema>

export const apiKeyResponseSchema = z.object({
  data: z.object({ api_key: z.string() }),
})

export const publisherMeSchema = publisherPublicSchema.extend({
  email: z.string().email(),
  has_api_key: z.boolean(),
  auth_method: z.enum(['api_key', 'session']),
})

export type PublisherMe = z.infer<typeof publisherMeSchema>

export const magicLinkRequestSchema = z.object({
  email: z.string().trim().email(),
})
