// Migration 0022 (publishers → accounts + organizers) rewrites production data, so it is tested against a real
// database: a scratch DB is migrated to 0021, filled with old-schema rows, then migrated with the real folder.
import { randomBytes } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { drizzle as drizzleOrm } from 'drizzle-orm/postgres-js'
import { ensureSuggestionsSource } from './suggestions.js'
import * as schema from './schema.js'

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://oedb:oedb@localhost:5432/oedb'
const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))
/** The last migration before the accounts/organizers split. */
const BEFORE_SPLIT = 21

const ORG = '00000000-0000-4000-8000-000000000001'
const SCOUT = '00000000-0000-4000-8000-000000000002'
const GHOST = '00000000-0000-4000-8000-000000000003'
const CO = '00000000-0000-4000-8000-000000000004'
const VENUE = '00000000-0000-4000-8000-000000000010'
const EV1 = '00000000-0000-4000-8000-000000000020'
const EV2 = '00000000-0000-4000-8000-000000000021'
const SOURCE = '00000000-0000-4000-8000-000000000030'

async function adminQuery(query: string) {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(query)
  } finally {
    await admin.end()
  }
}

async function scratchDb(): Promise<{ sql: postgres.Sql; url: string; drop: () => Promise<void> }> {
  const name = `oedb_mig_${randomBytes(6).toString('hex')}`
  await adminQuery(`CREATE DATABASE "${name}"`)
  const u = new URL(ADMIN_URL)
  u.pathname = `/${name}`
  const url = u.toString()
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  return {
    sql,
    url,
    drop: async () => {
      await sql.end()
      await adminQuery(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    },
  }
}

/** Applies the migrations up to and including `upToIdx` (all of them when null). */
async function migrateTo(url: string, upToIdx: number | null) {
  const migrationsFolder = await mkdtemp(path.join(tmpdir(), 'oedb-migrations-'))
  try {
    await cp(MIGRATIONS, migrationsFolder, { recursive: true })
    if (upToIdx !== null) {
      const journalPath = path.join(migrationsFolder, 'meta', '_journal.json')
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { idx: number }[] }
      journal.entries = journal.entries.filter((e) => e.idx <= upToIdx)
      await writeFile(journalPath, JSON.stringify(journal))
    }
    const client = postgres(url, { max: 1, onnotice: () => {} })
    try {
      await migrate(drizzle(client), { migrationsFolder })
    } finally {
      await client.end()
    }
  } finally {
    await rm(migrationsFolder, { recursive: true, force: true })
  }
}

/** Old-schema rows (at 0021): two organizer publishers, a scout, an unverified scout, events, auth, history, ingest. */
async function insertOldRows(sql: postgres.Sql) {
  await sql`
    insert into publishers (id, name, slug, email, verified, is_publisher, is_scout, api_key_hash, links) values
      (${ORG}, 'Org A', 'org-a', 'a@example.com', true, true, false, 'h1', ${sql.json({ website: 'https://a.example' })}),
      (${SCOUT}, 'Scout S', 'scout-s', 's@example.com', true, false, true, null, '{}'),
      (${GHOST}, 'Ghost', 'ghost', 'g@example.com', false, false, true, null, '{}'),
      (${CO}, 'Org B', 'org-b', 'b@example.com', true, true, false, null, '{}')`
  await sql`insert into venues (id, name, address, city) values (${VENUE}, 'Venue', 'Street 1', 'Berlin')`
  await sql`
    insert into events (id, title, starts_at, venue_id, city, created_by) values
      (${EV1}, 'Owned', '2026-12-01T20:00:00Z', ${VENUE}, 'Berlin', ${SCOUT}),
      (${EV2}, 'Unclaimed', '2026-12-02T20:00:00Z', ${VENUE}, 'Berlin', ${SCOUT})`
  await sql`
    insert into event_owners (event_id, publisher_id, role) values
      (${EV1}, ${ORG}, 'creator'),
      (${EV1}, ${CO}, 'co_owner')`
  await sql`insert into sessions (publisher_id, token_hash, expires_at) values (${ORG}, 'sess', now() + interval '1 day')`
  await sql`insert into magic_link_tokens (publisher_id, token_hash, expires_at) values (${ORG}, 'magic', now() + interval '1 hour')`
  await sql`
    insert into edit_history (entity_type, entity_id, publisher_id, action, diff) values
      ('publisher', ${ORG}, ${ORG}, 'updated', '{}'),
      ('event', ${EV1}, ${ORG}, 'created', '{}')`
  await sql`
    insert into ingest_sources (id, slug, name, kind, url, publisher_id) values
      (${SOURCE}, 'feed', 'Feed', 'ical', 'https://feed.example/events.ics', ${SCOUT})`
  await sql`
    insert into ingest_items (source_id, external_id, status, draft, raw, decided_by, event_id) values
      (${SOURCE}, 'x1', 'accepted', '{}', '', ${SCOUT}, ${EV2})`
}

describe('migration 0022: accounts and organizers', () => {
  let db: Awaited<ReturnType<typeof scratchDb>> | undefined

  beforeEach(async () => {
    db = await scratchDb()
    await migrateTo(db.url, BEFORE_SPLIT)
    await insertOldRows(db.sql)
  })

  afterEach(async () => {
    await db?.drop()
    db = undefined
  })

  it('splits publishers into accounts and organizers, keeping ids', async () => {
    const { sql, url } = db!
    await migrateTo(url, null)

    expect(await sql`select id, email, handle, display_name, is_scout, api_key_hash from accounts order by handle`).toEqual([
      // An unverified scout could not log in or write before, so it does not become a scout
      { id: GHOST, email: 'g@example.com', handle: 'ghost', display_name: 'Ghost', is_scout: false, api_key_hash: null },
      { id: ORG, email: 'a@example.com', handle: 'org-a', display_name: 'Org A', is_scout: false, api_key_hash: 'h1' },
      { id: CO, email: 'b@example.com', handle: 'org-b', display_name: 'Org B', is_scout: false, api_key_hash: null },
      { id: SCOUT, email: 's@example.com', handle: 'scout-s', display_name: 'Scout S', is_scout: true, api_key_hash: null },
    ])
    expect(await sql`select id, name, slug, links, verified from organizers order by slug`).toEqual([
      { id: ORG, name: 'Org A', slug: 'org-a', links: { website: 'https://a.example' }, verified: true },
      { id: CO, name: 'Org B', slug: 'org-b', links: {}, verified: true },
    ])
    expect(await sql`select organizer_id, account_id, role from organizer_members order by organizer_id`).toEqual([
      { organizer_id: ORG, account_id: ORG, role: 'owner' },
      { organizer_id: CO, account_id: CO, role: 'owner' },
    ])
    expect(await sql`select organizer_id, role from event_organizers where event_id = ${EV1} order by role::text`).toEqual([
      { organizer_id: CO, role: 'co_host' },
      { organizer_id: ORG, role: 'creator' },
    ])
    expect(await sql`select count(*)::int as n from event_organizers where event_id = ${EV2}`).toEqual([{ n: 0 }])
    expect(await sql`select id, created_by from events order by id`).toEqual([
      { id: EV1, created_by: SCOUT },
      { id: EV2, created_by: SCOUT },
    ])
    expect(await sql`select account_id from sessions`).toEqual([{ account_id: ORG }])
    expect(await sql`select account_id from magic_link_tokens`).toEqual([{ account_id: ORG }])
    expect(await sql`select entity_type, entity_id, account_id from edit_history order by entity_type::text`).toEqual([
      { entity_type: 'account', entity_id: ORG, account_id: ORG },
      { entity_type: 'event', entity_id: EV1, account_id: ORG },
    ])
    expect(await sql`select account_id from ingest_sources`).toEqual([{ account_id: SCOUT }])
    expect(await sql`select decided_by from ingest_items`).toEqual([{ decided_by: SCOUT }])
    expect(await sql`select to_regclass('publishers') as p, to_regclass('invites') as i, to_regclass('event_owners') as o`)
      .toEqual([{ p: null, i: null, o: null }])
  })

  it('points every former publisher reference at accounts or organizers, with the same onDelete', async () => {
    const { sql, url } = db!
    // Only up to 0022: later migrations add their own foreign keys to accounts
    await migrateTo(url, 22)

    expect(
      await sql`
        select conrelid::regclass::text as tbl, conname as name, confrelid::regclass::text as ref, confdeltype as on_delete
        from pg_constraint
        where contype = 'f' and confrelid in ('accounts'::regclass, 'organizers'::regclass)
        order by conname`,
    ).toEqual([
      { tbl: 'edit_history', name: 'edit_history_account_id_accounts_id_fk', ref: 'accounts', on_delete: 'r' },
      { tbl: 'event_organizers', name: 'event_organizers_organizer_id_organizers_id_fk', ref: 'organizers', on_delete: 'c' },
      { tbl: 'events', name: 'events_created_by_accounts_id_fk', ref: 'accounts', on_delete: 'r' },
      { tbl: 'ingest_items', name: 'ingest_items_decided_by_accounts_id_fk', ref: 'accounts', on_delete: 'n' },
      { tbl: 'ingest_sources', name: 'ingest_sources_account_id_accounts_id_fk', ref: 'accounts', on_delete: 'r' },
      { tbl: 'magic_link_tokens', name: 'magic_link_tokens_account_id_accounts_id_fk', ref: 'accounts', on_delete: 'c' },
      { tbl: 'organizer_members', name: 'organizer_members_account_id_accounts_id_fk', ref: 'accounts', on_delete: 'c' },
      { tbl: 'organizer_members', name: 'organizer_members_organizer_id_organizers_id_fk', ref: 'organizers', on_delete: 'c' },
      { tbl: 'sessions', name: 'sessions_account_id_accounts_id_fk', ref: 'accounts', on_delete: 'c' },
    ])
    const enumValues = async (type: string) =>
      (await sql`select enumlabel from pg_enum where enumtypid = to_regtype(${type}) order by enumsortorder`).map(
        (r) => r.enumlabel,
      )
    expect(await enumValues('event_organizer_role')).toEqual(['creator', 'co_host'])
    expect(await enumValues('edit_history_entity_type')).toEqual(['event', 'venue', 'account', 'organizer'])
    expect(await enumValues('organizer_member_role')).toEqual(['owner', 'member'])
    // At most one creator per event, as before
    await expect(
      sql`insert into event_organizers (event_id, organizer_id, role) values (${EV1}, ${CO}, 'creator')
          on conflict (event_id, organizer_id) do update set role = excluded.role`,
    ).rejects.toThrow(/event_organizers_one_creator_per_event/)
  })

  it('refuses to migrate when a scout owns an event', async () => {
    const { sql, url } = db!
    await sql`insert into event_owners (event_id, publisher_id, role) values (${EV2}, ${SCOUT}, 'creator')`

    await expect(migrateTo(url, null)).rejects.toThrow(/event_owners rows point at publishers that are not organizers/)
    expect(await sql`select to_regclass('publishers') as p, to_regclass('accounts') as a`).toEqual([
      { p: 'publishers', a: null },
    ])
  })

  it('refuses to migrate when invites has rows', async () => {
    const { sql, url } = db!
    await sql`insert into invites (token, invited_by, email, expires_at) values ('t', ${ORG}, 'x@example.com', now())`

    await expect(migrateTo(url, null)).rejects.toThrow(/invites is not empty/)
    expect(await sql`select to_regclass('publishers') as p, to_regclass('accounts') as a`).toEqual([
      { p: 'publishers', a: null },
    ])
  })

  it('refuses to migrate when edit history has invite entries', async () => {
    const { sql, url } = db!
    await sql`
      insert into edit_history (entity_type, entity_id, publisher_id, action, diff)
      values ('invite', ${ORG}, ${ORG}, 'created', '{}')`

    await expect(migrateTo(url, null)).rejects.toThrow(/edit_history has entries for invites/)
    expect(await sql`select to_regclass('publishers') as p, to_regclass('accounts') as a`).toEqual([
      { p: 'publishers', a: null },
    ])
  })
})

describe('migration 0023: onboarding, token kinds and event interests', () => {
  let db: Awaited<ReturnType<typeof scratchDb>> | undefined
  const ACC = '00000000-0000-4000-8000-0000000000a1'

  beforeEach(async () => {
    db = await scratchDb()
    await migrateTo(db.url, 22)
    const { sql } = db
    await sql`insert into accounts (id, email, handle, display_name, created_at)
      values (${ACC}, 'acc@example.com', 'acc', 'Acc', '2026-01-02T03:04:05Z')`
    await sql`insert into magic_link_tokens (account_id, token_hash, expires_at) values (${ACC}, 'tok', now() + interval '1 hour')`
    await sql`insert into venues (id, name, address, city) values (${VENUE}, 'Venue', 'Street 1', 'Berlin')`
    await sql`insert into events (id, title, starts_at, venue_id, city, created_by)
      values (${EV1}, 'E', '2026-12-01T20:00:00Z', ${VENUE}, 'Berlin', ${ACC})`
  })

  afterEach(async () => {
    await db?.drop()
    db = undefined
  })

  it('backfills onboarded_at and token email/kind, and allows account-less signup tokens', async () => {
    const { sql, url } = db!
    await migrateTo(url, null)

    expect(await sql`select onboarded_at = created_at as same, terms_accepted_at, calendar_token from accounts`).toEqual([
      { same: true, terms_accepted_at: null, calendar_token: null },
    ])
    expect(await sql`select email, kind, account_id from magic_link_tokens`).toEqual([
      { email: 'acc@example.com', kind: 'login', account_id: ACC },
    ])
    await sql`insert into magic_link_tokens (account_id, email, kind, token_hash, expires_at, request_ip)
      values (null, 'new@example.com', 'signup', 'tok2', now() + interval '1 hour', '203.0.113.1')`
    expect(await sql`select count(*)::int as n from magic_link_tokens where kind = 'signup'`).toEqual([{ n: 1 }])
  })

  it('cascades event_interests on event and account deletion', async () => {
    const { sql, url } = db!
    await migrateTo(url, null)
    const EV3 = '00000000-0000-4000-8000-000000000022'
    await sql`insert into events (id, title, starts_at, venue_id, city, created_by)
      values (${EV3}, 'E3', '2026-12-03T20:00:00Z', ${VENUE}, 'Berlin', ${ACC})`
    await sql`insert into event_interests (account_id, event_id) values (${ACC}, ${EV1}), (${ACC}, ${EV3})`

    await sql`delete from events where id = ${EV1}`
    expect(await sql`select event_id from event_interests`).toEqual([{ event_id: EV3 }])

    const ACC2 = '00000000-0000-4000-8000-0000000000a2'
    await sql`insert into accounts (id, email, handle, display_name) values (${ACC2}, 'b@example.com', 'b', 'B')`
    await sql`insert into event_interests (account_id, event_id) values (${ACC2}, ${EV3})`
    await sql`delete from accounts where id = ${ACC2}`
    expect(await sql`select account_id from event_interests`).toEqual([{ account_id: ACC }])
  })
})

describe('migration 0024: suggestions', () => {
  let db: Awaited<ReturnType<typeof scratchDb>> | undefined

  beforeEach(async () => {
    db = await scratchDb()
    await migrateTo(db.url, null)
  })

  afterEach(async () => {
    await db?.drop()
    db = undefined
  })

  it('ensureSuggestionsSource is idempotent and creates one suggestion source without an account', async () => {
    const { sql } = db!
    const orm = drizzleOrm(sql, { schema }) as unknown as Parameters<typeof ensureSuggestionsSource>[0]
    const first = await ensureSuggestionsSource(orm)
    const second = await ensureSuggestionsSource(orm)
    expect(second).toBe(first)
    expect(await sql`select id, slug, name, kind, url, official, enabled, account_id, venue_id from ingest_sources`).toEqual([
      {
        id: first,
        slug: 'suggestions',
        name: 'Suggestions',
        kind: 'suggestion',
        url: 'https://kellerkompass.de/',
        official: false,
        enabled: true,
        account_id: null,
        venue_id: null,
      },
    ])
  })

  it('a feed source still needs an account', async () => {
    const { sql } = db!
    await expect(
      sql`insert into ingest_sources (slug, name, kind, url, account_id) values ('feed', 'Feed', 'ical', 'https://feed.example/e.ics', null)`,
    ).rejects.toMatchObject({ constraint_name: 'ingest_sources_account_required' })
  })
})
