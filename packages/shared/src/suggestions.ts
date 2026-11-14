import { z } from 'zod'
import { eventFieldsSchema } from './events.js'

/** What a person may suggest: event fields without organizer, tags and recurrence (a scout adds those on accept). */
export const suggestionCreateSchema = eventFieldsSchema.omit({ tags: true, recurrence: true })

export type SuggestionCreateInput = z.infer<typeof suggestionCreateSchema>

export const mySuggestionStatusSchema = z.enum(['in_review', 'live', 'not_accepted'])

/** One of the account's own suggestions, as it sees it. */
export const mySuggestionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  starts_at: z.string().datetime({ offset: true }),
  status: mySuggestionStatusSchema,
  event_id: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  image_url: z.string().url().nullable(),
  created_at: z.string().datetime({ offset: true }),
})

export type MySuggestion = z.infer<typeof mySuggestionSchema>
