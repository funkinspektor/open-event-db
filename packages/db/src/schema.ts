import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  point,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const eventStatus = pgEnum('event_status', ['scheduled', 'cancelled', 'postponed'])
export const eventCategory = pgEnum('event_category', ['concert', 'party'])
export const eventOwnerRole = pgEnum('event_owner_role', ['creator', 'co_owner'])
export const editHistoryEntityType = pgEnum('edit_history_entity_type', [
  'event',
  'venue',
  'publisher',
  'invite',
])
export const editHistoryAction = pgEnum('edit_history_action', [
  'created',
  'updated',
  'cancelled',
  'ownership_changed',
  'deleted',
])

export const ingestSourceKind = pgEnum('ingest_source_kind', ['ical', 'dunckerclub', 'urbanspree', 'berghain', 'slaughterhouse'])
export const ingestItemStatus = pgEnum('ingest_item_status', ['pending', 'accepted', 'rejected'])
export const ingestFitVerdict = pgEnum('ingest_fit_verdict', ['fit', 'maybe', 'no'])

type Links = Record<string, string>
/** Same shape as `Lineup` in @open-event-db/shared, which validates it. */
type Lineup = { name: string | null; acts: { name: string; time: string | null; live: boolean; note: string | null }[] }[]

export const publishers = pgTable('publishers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  email: text('email').notNull().unique(),
  verified: boolean('verified').notNull().default(false),
  /** Creates owned events. False for pure scouts. */
  isPublisher: boolean('is_publisher').notNull().default(true),
  /** Adds unclaimed events on behalf of organizers who aren't on the platform yet. */
  isScout: boolean('is_scout').notNull().default(false),
  invitedBy: uuid('invited_by').references((): any => publishers.id, { onDelete: 'set null' }),
  apiKeyHash: text('api_key_hash'),
  links: jsonb('links').$type<Links>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const venues = pgTable('venues', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  address: text('address').notNull(),
  city: text('city').notNull(),
  coordinates: point('coordinates'),
  links: jsonb('links').$type<Links>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** Groups of acts in listed order; `[]` when only the description names them (or nobody does). */
    lineup: jsonb('lineup').$type<Lineup>().notNull().default([]),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /** False when only the day is known (flyers often have no time): starts_at is then 00:00 Berlin that day. */
    startTimeKnown: boolean('start_time_known').notNull().default(true),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    venueId: uuid('venue_id').references(() => venues.id, { onDelete: 'set null' }),
    locationText: text('location_text'),
    city: text('city').notNull(),
    /** Optional; a concert with a party afterwards has both. */
    categories: eventCategory('categories').array().notNull().default(sql`ARRAY[]::event_category[]`),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    links: jsonb('links').$type<Links>().notNull().default({}),
    /** Immutable "Added by": survives claims, so provenance is kept. Ownership lives in event_owners. */
    createdBy: uuid('created_by')
      .notNull()
      .references(() => publishers.id, { onDelete: 'restrict' }),
    status: eventStatus('status').notNull().default('scheduled'),
    recurrence: text('recurrence'),
    /** Object key in the image store (`events/<id>/<uuid>.jpg`); the API turns it into `image_url`. */
    imageKey: text('image_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('events_tags_gin_idx').using('gin', t.tags),
    index('events_categories_gin_idx').using('gin', t.categories),
  ],
)

export const eventOwners = pgTable(
  'event_owners',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    publisherId: uuid('publisher_id')
      .notNull()
      .references(() => publishers.id, { onDelete: 'cascade' }),
    role: eventOwnerRole('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.publisherId] }),
    // At most one creator. An event without any owner row is unclaimed (added by a scout).
    uniqueIndex('event_owners_one_creator_per_event')
      .on(t.eventId)
      .where(sql`${t.role} = 'creator'`),
  ],
)

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: text('token').notNull().unique(),
  invitedBy: uuid('invited_by')
    .notNull()
    .references(() => publishers.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  claimedBy: uuid('claimed_by').references(() => publishers.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  publisherId: uuid('publisher_id')
    .notNull()
    .references(() => publishers.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const magicLinkTokens = pgTable('magic_link_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  publisherId: uuid('publisher_id')
    .notNull()
    .references(() => publishers.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})

export const editHistory = pgTable('edit_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityType: editHistoryEntityType('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  publisherId: uuid('publisher_id')
    .notNull()
    .references(() => publishers.id, { onDelete: 'restrict' }),
  action: editHistoryAction('action').notNull(),
  // Field changes as { before, after }; CLI actions add `via: 'cli'`
  diff: jsonb('diff').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const ingestSources = pgTable('ingest_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  kind: ingestSourceKind('kind').notNull(),
  url: text('url').notNull(),
  /** Scout publisher that sync edits are attributed to. */
  publisherId: uuid('publisher_id')
    .notNull()
    .references(() => publishers.id, { onDelete: 'restrict' }),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  /** The venue whose program this feed carries; null for aggregators and organizers that play many venues. */
  venueId: uuid('venue_id').references(() => venues.id, { onDelete: 'set null' }),
  /** The venue's or organizer's own site: an event it lists counts as confirmed by the venue. False for aggregators. */
  official: boolean('official').notNull().default(true),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastError: text('last_error'),
  lastItemCount: integer('last_item_count'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const ingestItems = pgTable(
  'ingest_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => ingestSources.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    status: ingestItemStatus('status').notNull().default('pending'),
    draft: jsonb('draft').$type<Record<string, unknown>>().notNull(),
    raw: text('raw').notNull(),
    /** Null means extraction must be retried on the next run. */
    contentHash: text('content_hash'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    goneAt: timestamp('gone_at', { withTimezone: true }),
    goneResolvedAt: timestamp('gone_resolved_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => publishers.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    detachedAt: timestamp('detached_at', { withTimezone: true }),
    /** The feed image URL the event's current image was copied from; differs from the draft's until synced. */
    imageSourceUrl: text('image_source_url'),
    /** LLM verdict on whether the item fits the platform's taste; null until scored. Shadow only, never acted on. */
    fitVerdict: ingestFitVerdict('fit_verdict'),
    fitReason: text('fit_reason'),
    fitScoredAt: timestamp('fit_scored_at', { withTimezone: true }),
    /** Hash of what the verdict was based on; a changed fingerprint means the item is re-scored. */
    fitFingerprint: text('fit_fingerprint'),
    /** Set when a scout rejected the item while the inbox showed duplicate candidates for it. */
    hadDuplicates: boolean('had_duplicates').notNull().default(false),
  },
  (t) => [
    uniqueIndex('ingest_items_source_external').on(t.sourceId, t.externalId),
    index('ingest_items_event_idx').on(t.eventId),
  ],
)

export type Publisher = typeof publishers.$inferSelect
export type NewPublisher = typeof publishers.$inferInsert
export type Venue = typeof venues.$inferSelect
export type NewVenue = typeof venues.$inferInsert
export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type EventOwner = typeof eventOwners.$inferSelect
export type NewEventOwner = typeof eventOwners.$inferInsert
export type Invite = typeof invites.$inferSelect
export type NewInvite = typeof invites.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type MagicLinkToken = typeof magicLinkTokens.$inferSelect
export type NewMagicLinkToken = typeof magicLinkTokens.$inferInsert
export type EditHistoryEntry = typeof editHistory.$inferSelect
export type NewEditHistoryEntry = typeof editHistory.$inferInsert
export type IngestSource = typeof ingestSources.$inferSelect
export type NewIngestSource = typeof ingestSources.$inferInsert
export type IngestItem = typeof ingestItems.$inferSelect
export type NewIngestItem = typeof ingestItems.$inferInsert
