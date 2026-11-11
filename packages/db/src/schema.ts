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
export const eventOrganizerRole = pgEnum('event_organizer_role', ['creator', 'co_host'])
export const magicLinkKind = pgEnum('magic_link_kind', ['login', 'signup', 'email_change'])
export const organizerMemberRole = pgEnum('organizer_member_role', ['owner', 'member'])
export const editHistoryEntityType = pgEnum('edit_history_entity_type', [
  'event',
  'venue',
  'account',
  'organizer',
])
export const editHistoryAction = pgEnum('edit_history_action', [
  'created',
  'updated',
  'cancelled',
  'ownership_changed',
  'deleted',
])

export const ingestSourceKind = pgEnum('ingest_source_kind', ['ical', 'dunckerclub', 'urbanspree', 'berghain', 'slaughterhouse', 'squarespace', 'schokoladen', 'festsaal', 'lido', 'supamolly', 'beateuwe', 'so36', 'frannz'])
export const ingestItemStatus = pgEnum('ingest_item_status', ['pending', 'accepted', 'rejected'])
export const ingestFitVerdict = pgEnum('ingest_fit_verdict', ['fit', 'maybe', 'no'])

type Links = Record<string, string>
/** Same shape as `Lineup` in @open-event-db/shared, which validates it. */
type Lineup = { name: string | null; acts: { name: string; time: string | null; live: boolean; note: string | null }[] }[]

/** A person with a login. Rights come from `is_scout` and from membership in a verified organizer. */
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  /** Slug format; a separate namespace from organizer slugs. */
  handle: text('handle').notNull().unique(),
  displayName: text('display_name').notNull(),
  /** Adds and edits unclaimed events on behalf of organizers who aren't on the platform yet. */
  isScout: boolean('is_scout').notNull().default(false),
  /** API keys act with the account's rights. */
  apiKeyHash: text('api_key_hash'),
  /** Set when the account has finished onboarding (handle and display name chosen); null while it is still pending. */
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  /** When the person accepted the terms at sign-up; null for accounts created before sign-up existed. */
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
  /** Secret in the personal calendar feed URL. */
  calendarToken: text('calendar_token').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** The public profile of whoever makes events: a collective, a solo DJ, the team running a venue. */
export const organizers = pgTable('organizers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  links: jsonb('links').$type<Links>().notNull().default({}),
  /** Only members of a verified organizer act for it. */
  verified: boolean('verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const organizerMembers = pgTable(
  'organizer_members',
  {
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    role: organizerMemberRole('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizerId, t.accountId] })],
)

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
    /** Immutable "Added by" account: survives claims, so provenance is kept. Ownership lives in event_organizers. */
    createdBy: uuid('created_by')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
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

export const eventOrganizers = pgTable(
  'event_organizers',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id, { onDelete: 'cascade' }),
    role: eventOrganizerRole('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.organizerId] }),
    // At most one creator. An event without any organizer row is unclaimed (added by a scout).
    uniqueIndex('event_organizers_one_creator_per_event')
      .on(t.eventId)
      .where(sql`${t.role} = 'creator'`),
  ],
)

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const magicLinkTokens = pgTable(
  'magic_link_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null for sign-up tokens: the account is created when the link is used. */
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    kind: magicLinkKind('kind').notNull().default('login'),
    returnTo: text('return_to'),
    /** The address an email_change token switches the account to. */
    newEmail: text('new_email'),
    /** Set for sign-up tokens, for the per-IP cap. */
    requestIp: text('request_ip'),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [index('magic_link_tokens_kind_ip_created_idx').on(t.kind, t.requestIp, t.createdAt)],
)

/** An account's "I'm interested" mark on an event. */
export const eventInterests = pgTable(
  'event_interests',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.eventId] }), index('event_interests_event_idx').on(t.eventId)],
)

export const editHistory = pgTable('edit_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityType: editHistoryEntityType('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'restrict' }),
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
  /** Scout account that sync edits are attributed to. */
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'restrict' }),
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
    decidedBy: uuid('decided_by').references(() => accounts.id, { onDelete: 'set null' }),
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

export type Account = typeof accounts.$inferSelect
export type NewAccount = typeof accounts.$inferInsert
export type Organizer = typeof organizers.$inferSelect
export type NewOrganizer = typeof organizers.$inferInsert
export type OrganizerMember = typeof organizerMembers.$inferSelect
export type NewOrganizerMember = typeof organizerMembers.$inferInsert
export type Venue = typeof venues.$inferSelect
export type NewVenue = typeof venues.$inferInsert
export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type EventOrganizer = typeof eventOrganizers.$inferSelect
export type NewEventOrganizer = typeof eventOrganizers.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type MagicLinkToken = typeof magicLinkTokens.$inferSelect
export type NewMagicLinkToken = typeof magicLinkTokens.$inferInsert
export type EventInterest = typeof eventInterests.$inferSelect
export type NewEventInterest = typeof eventInterests.$inferInsert
export type EditHistoryEntry = typeof editHistory.$inferSelect
export type NewEditHistoryEntry = typeof editHistory.$inferInsert
export type IngestSource = typeof ingestSources.$inferSelect
export type NewIngestSource = typeof ingestSources.$inferInsert
export type IngestItem = typeof ingestItems.$inferSelect
export type NewIngestItem = typeof ingestItems.$inferInsert
