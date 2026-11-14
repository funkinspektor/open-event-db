import { z } from 'zod'
import { eventDetailSchema, eventFieldsSchema } from './events.js'

/** What a person may suggest: event fields without organizer, tags and recurrence (a scout adds those on accept). */
export const suggestionCreateSchema = eventFieldsSchema.omit({ tags: true, recurrence: true })

export type SuggestionCreateInput = z.infer<typeof suggestionCreateSchema>

/** `expired`: never decided, and its event is over (it left the inbox). */
export const mySuggestionStatusSchema = z.enum(['in_review', 'live', 'not_accepted', 'expired'])

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

/**
 * `GET /suggestions/:id`: the suggestion plus the event it would become, in the event detail shape so the
 * event page can show it. Ids and timestamps of the preview are the suggestion's own; there are no organizers.
 */
export const suggestionPreviewSchema = z.object({
  suggestion: mySuggestionSchema,
  preview: eventDetailSchema,
})

export type SuggestionPreview = z.infer<typeof suggestionPreviewSchema>
