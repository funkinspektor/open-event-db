import { z } from 'zod'
import { linksSchema } from './links.js'

const iso = z.string().datetime({ offset: true })
const uuid = z.string().uuid()

/** Per-source settings stored in `ingest_sources.config`; every key is optional on input. */
export const ingestSourceConfigSchema = z.object({
  /** Floating feed times are read in this zone; explicit `Z`/TZID times are kept as given. */
  timezone: z.string().min(1).default('Europe/Berlin'),
  /** Only feed events starting within this many days from now are imported. */
  horizon_days: z.number().int().min(1).default(180),
  /** Regex whose first capture group (or whole match) extracts the stable id from the feed UID. */
  external_id_pattern: z
    .string()
    .nullable()
    .default(null)
    .refine(
      (pattern) => {
        if (pattern === null) return true
        try {
          new RegExp(pattern)
          return true
        } catch {
          return false
        }
      },
      { message: 'external_id_pattern must be a valid regular expression' },
    ),
  /** Feed location string -> venue id. */
  venues: z.record(z.string().min(1), uuid).default({}),
  extract_from_text: z.boolean().default(false),
  city: z.string().min(1).default('Berlin'),
  /** Only feed events in these rooms (first part of LOCATION, case-insensitive) are imported; null = all. */
  rooms: z.array(z.string().min(1)).min(1).nullable().default(null),
})

export type IngestSourceConfig = z.infer<typeof ingestSourceConfigSchema>

/** What the scout reviews and, on accept, becomes an event. Stored in `ingest_items.draft`. */
export const ingestDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  starts_at: iso,
  ends_at: iso.nullable(),
  venue_id: uuid.nullable(),
  location_text: z.string().nullable(),
  city: z.string(),
  links: linksSchema,
  image_url: z.string().url().nullable(),
  source_url: z.string().url().nullable(),
  times_unverified: z.boolean(),
})

export type IngestDraft = z.infer<typeof ingestDraftSchema>

export const duplicateCandidateSchema = z.object({
  id: uuid,
  title: z.string(),
  starts_at: iso,
  ends_at: iso.nullable(),
  venue_name: z.string().nullable(),
  added_by_name: z.string(),
  similarity: z.number(),
  likely: z.boolean(),
})

export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>

export const ingestItemStatusSchema = z.enum(['pending', 'accepted', 'rejected'])

export const ingestItemViewSchema = z.object({
  id: uuid,
  status: ingestItemStatusSchema,
  source: z.object({ slug: z.string(), name: z.string() }),
  draft: ingestDraftSchema,
  /** Name of the draft's mapped venue, null without one. */
  venue_name: z.string().nullable(),
  gone_at: iso.nullable(),
  event_id: uuid.nullable(),
  duplicates: z.array(duplicateCandidateSchema),
})

export type IngestItemView = z.infer<typeof ingestItemViewSchema>

export const ingestListQuerySchema = z.object({
  view: z.enum(['new', 'gone']).default('new'),
})

export const ingestRejectSchema = z.object({
  ids: z.array(uuid).min(1).max(100),
})

export const ingestLinkSchema = z.object({
  event_id: uuid,
})

export const ingestGoneSchema = z.object({
  action: z.enum(['cancel', 'keep']),
})

/** Duplicate lookup for the create form and inbox items. */
export const duplicateQuerySchema = z.object({
  venue_id: uuid.optional(),
  location_text: z.string().optional(),
  starts_at: iso,
  ends_at: iso.optional(),
  title: z.string().optional(),
  exclude_id: uuid.optional(),
})

export type DuplicateQuery = z.infer<typeof duplicateQuerySchema>
