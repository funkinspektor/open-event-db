import { z } from 'zod'
import { linksSchema } from './links.js'
import { lineupSchema } from './lineup.js'
import { eventCategorySchema, venueDetailEmbedSchema } from './events.js'
import { cursorQuerySchema } from './pagination.js'

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
  /** LOCATION for feed events that have none (a venue's own feed); `venues` and `rooms` then apply to it. */
  default_location: z.string().min(1).nullable().default(null),
  /** The feed lists only its next N events, not a date range: items after its last event are not marked gone. */
  capped: z.boolean().default(false),
  /** Categories for feed events whose text names none (or that are not read at all), e.g. `party` for a club. */
  default_categories: z.array(eventCategorySchema).default([]),
})

export type IngestSourceConfig = z.infer<typeof ingestSourceConfigSchema>

/** What the scout reviews and, on accept, becomes an event. Stored in `ingest_items.draft`. */
export const ingestDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  /** Drafts stored before lineups existed have none. */
  lineup: lineupSchema.default([]),
  starts_at: iso,
  ends_at: iso.nullable(),
  venue_id: uuid.nullable(),
  location_text: z.string().nullable(),
  city: z.string(),
  /** Drafts stored before categories existed have none. */
  categories: z.array(eventCategorySchema).default([]),
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
  start_time_known: z.boolean(),
  ends_at: iso.nullable(),
  venue_name: z.string().nullable(),
  added_by_name: z.string(),
  similarity: z.number(),
  likely: z.boolean(),
})

export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>

export const ingestItemStatusSchema = z.enum(['pending', 'accepted', 'rejected'])

export const ingestFitVerdictSchema = z.enum(['fit', 'maybe', 'no'])
export type IngestFitVerdict = z.infer<typeof ingestFitVerdictSchema>

export const ingestItemViewSchema = z.object({
  id: uuid,
  status: ingestItemStatusSchema,
  source: z.object({ slug: z.string(), name: z.string() }),
  draft: ingestDraftSchema,
  /** Name of the draft's mapped venue, null without one. */
  venue_name: z.string().nullable(),
  gone_at: iso.nullable(),
  event_id: uuid.nullable(),
  /** The model's verdict on the item and why; null while unscored. */
  fit: z.object({ verdict: ingestFitVerdictSchema, reason: z.string() }).nullable(),
  duplicates: z.array(duplicateCandidateSchema),
})

export type IngestItemView = z.infer<typeof ingestItemViewSchema>

/**
 * Where an item stands for a scout: `new` (including filtered-out items) and `gone` are the inbox views (with their actions); `accepted`
 * and `rejected` are decided; `over` ended before a decision; `removed` left its feed before a decision.
 */
export const ingestItemStateSchema = z.enum(['new', 'gone', 'accepted', 'rejected', 'over', 'removed'])
export type IngestItemState = z.infer<typeof ingestItemStateSchema>

export const ingestItemDetailSchema = ingestItemViewSchema.extend({
  state: ingestItemStateSchema,
  /** The draft's mapped venue with address and coordinates, as on an event page. */
  venue: venueDetailEmbedSchema.nullable(),
})

export type IngestItemDetail = z.infer<typeof ingestItemDetailSchema>

/** The inbox views: `filtered` holds the pending items the model judged not to fit; `new` the rest. */
export const ingestViewSchema = z.enum(['new', 'filtered', 'gone'])
export type IngestView = z.infer<typeof ingestViewSchema>

/** One inbox view, a page at a time, optionally of one source (by slug). */
export const ingestListQuerySchema = cursorQuerySchema.extend({
  view: ingestViewSchema.default('new'),
  source: z.string().min(1).optional(),
})

/** A source with items in the listed view, for the inbox's source filter. */
export const ingestSourceCountSchema = z.object({
  slug: z.string(),
  name: z.string(),
  count: z.number().int(),
})

export type IngestSourceCount = z.infer<typeof ingestSourceCountSchema>

/** How the scouts' decisions of the last 60 days compare with the model's verdicts, for one source. */
export const ingestAccuracyRowSchema = z.object({
  slug: z.string(),
  name: z.string(),
  /** Items judged `fit` that a scout accepted or rejected. */
  fit_decided: z.number().int(),
  fit_accepted: z.number().int(),
  /** Items judged `no` that a scout accepted or rejected. */
  no_decided: z.number().int(),
  no_rejected: z.number().int(),
  /** Judged `no` but accepted anyway. */
  rescued: z.number().int(),
})

export type IngestAccuracyRow = z.infer<typeof ingestAccuracyRowSchema>

export const ingestRejectSchema = z.object({
  ids: z.array(uuid).min(1).max(100),
})

/** Event fields a link can take over from the feed's version; `times` is start and end, `place` venue or location. */
export const ingestMergeFieldSchema = z.enum(['title', 'description', 'lineup', 'times', 'place', 'categories', 'image'])
export type IngestMergeField = z.infer<typeof ingestMergeFieldSchema>

/** The fields the feed keeps current on an event it stays attached to: a synced link takes them all. */
export const INGEST_SYNCED_FIELDS: readonly IngestMergeField[] = ingestMergeFieldSchema.options
/** The one link the feed keeps current; the event's other links stay as they are. */
export const SYNCED_LINK = 'website'

export const ingestLinkSchema = z.object({
  event_id: uuid,
  /** Fields the feed's version replaces on the event; the others stay as they are. */
  fields: z.array(ingestMergeFieldSchema).default([]),
  /** Link keys (`tickets`, `website`, …) whose feed URL replaces or joins the event's. */
  links: z.array(z.string().min(1)).max(20).default([]),
  /** Keep the item attached, so later feed changes reach the event; implies every synced field. */
  sync: z.boolean().default(false),
})

export type IngestLinkInput = z.input<typeof ingestLinkSchema>

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
