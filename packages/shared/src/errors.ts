import { z } from 'zod'

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
})

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>
