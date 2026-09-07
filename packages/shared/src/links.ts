import { z } from 'zod'

export const linksSchema = z.record(z.string().min(1), z.string().url())
export type Links = z.infer<typeof linksSchema>
