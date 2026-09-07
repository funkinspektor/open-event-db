import { z } from 'zod'

export const tagsResponseSchema = z.object({
  data: z.array(z.string()),
})

export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
}
