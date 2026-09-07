import { z } from 'zod'

export const cursorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
})

export type CursorQuery = z.infer<typeof cursorQuerySchema>

export const metaSchema = z.object({
  cursor: z.string().nullable(),
  has_more: z.boolean(),
})

export type Meta = z.infer<typeof metaSchema>
