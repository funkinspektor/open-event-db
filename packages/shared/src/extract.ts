import { z } from 'zod'
import { linksSchema } from './links.js'

/** Image types accepted by `POST /events/extract`. */
export const EXTRACT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type ExtractImageType = (typeof EXTRACT_IMAGE_TYPES)[number]
/**
 * Request body limit for all images of one extraction together (raw body or multipart). 6 MiB is safe
 * whether or not Scaleway Serverless Containers still cap request payloads at that size.
 */
export const EXTRACT_MAX_BYTES = 6 * 1024 * 1024
/** Images per extraction — the Scaleway Generative APIs limit per request. */
export const EXTRACT_MAX_IMAGES = 12
/** Clients downscale to this many pixels on the long edge before upload. */
export const EXTRACT_MAX_EDGE_PX = 1600
/**
 * Taller images (full-page captures) are cropped from the top to this height:width ratio first —
 * otherwise downscaling makes their text unreadable. Event pages put the key facts at the top.
 */
export const EXTRACT_MAX_ASPECT = 2
/** Extractions per account per day; session and API key share the counter. */
export const EXTRACT_DAILY_LIMIT = 30

export const weekdaySchema = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
export type Weekday = z.infer<typeof weekdaySchema>

/** A calendar date exactly as written on the image; year and weekday only when shown. */
const writtenDateSchema = z.object({
  day: z.number().int(),
  month: z.number().int(),
  year: z.number().int().nullable(),
  weekday: weekdaySchema.nullable(),
})

export type WrittenDate = z.infer<typeof writtenDateSchema>

export const extractedLinkKindSchema = z.enum([
  'tickets',
  'instagram',
  'facebook',
  'resident_advisor',
  'telegram',
  'soundcloud',
  'bandcamp',
  'website',
])

export type ExtractedLinkKind = z.infer<typeof extractedLinkKindSchema>

/**
 * What the vision model returns: only what is literally visible on the image.
 * Dates stay unresolved here — the API turns them into timestamps (see the Event Capture PRD's date rules),
 * so "no guessing" is enforced in code rather than left to the model.
 */
export const extractionSchema = z.object({
  title: z.string().nullable(),
  date: writtenDateSchema.nullable(),
  start_time: z.string().nullable(),
  end_date: writtenDateSchema.nullable(),
  end_time: z.string().nullable(),
  venue_name: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  description: z.string().nullable(),
  lineup: z.array(z.string()),
  tags: z.array(z.string()),
  links: z.array(z.object({ kind: extractedLinkKindSchema, url: z.string() })),
})

export type Extraction = z.infer<typeof extractionSchema>

/** The pre-fill for the create form. Every field may be empty; the user reviews all of them. */
export const eventDraftSchema = z.object({
  title: z.string().nullable(),
  /** Berlin calendar day (YYYY-MM-DD), also set when the start time is unknown. */
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  /** Only set when both date and time were readable. */
  starts_at: z.string().datetime({ offset: true }).nullable(),
  ends_at: z.string().datetime({ offset: true }).nullable(),
  venue_name: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string(),
  description: z.string().nullable(),
  /** Artist names; the web form appends them to the description. */
  lineup: z.array(z.string()),
  tags: z.array(z.string()),
  links: linksSchema,
})

export type EventDraft = z.infer<typeof eventDraftSchema>

export const eventDraftResponseSchema = z.object({
  data: eventDraftSchema,
})
