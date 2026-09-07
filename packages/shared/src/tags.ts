import { z } from 'zod'

export const tagsResponseSchema = z.object({
  data: z.array(z.string()),
})
