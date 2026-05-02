import { sql } from 'drizzle-orm'
import {
  boolean,
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
])

type Links = Record<string, string>

export const publishers = pgTable('publishers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  email: text('email').notNull().unique(),
  verified: boolean('verified').notNull().default(false),
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

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  venueId: uuid('venue_id').references(() => venues.id, { onDelete: 'set null' }),
  locationText: text('location_text'),
  city: text('city').notNull(),
  tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
  links: jsonb('links').$type<Links>().notNull().default({}),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => publishers.id, { onDelete: 'restrict' }),
  status: eventStatus('status').notNull().default('scheduled'),
  recurrence: text('recurrence'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

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
  diff: jsonb('diff').$type<Record<string, { before: unknown; after: unknown }>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

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
