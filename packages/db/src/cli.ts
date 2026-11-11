import { createInterface } from 'node:readline/promises'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { EVENT_TZ, ingestSourceConfigSchema } from '@open-event-db/shared'
import { createDb } from './index.js'
import {
  accounts,
  editHistory,
  eventOrganizers,
  events,
  ingestItems,
  ingestSourceKind,
  ingestSources,
  magicLinkTokens,
  organizerMembers,
  organizers,
  sessions,
  venues,
} from './schema.js'
import { generateApiKey } from './tokens.js'
import { imageRemovalNotice } from './images.js'

const url = process.env.DATABASE_URL ?? 'postgres://oedb:oedb@localhost:5432/oedb'
const db = createDb(url)

const rawArgv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"))
// --config, --kind, --venue and --name take the next argument as their value, so they are pulled out before the bare flags are sorted
const configAt = rawArgv.indexOf('--config')
const configArg = configAt === -1 ? undefined : rawArgv[configAt + 1]
const kindAt = rawArgv.indexOf('--kind')
const kindArg = kindAt === -1 ? undefined : rawArgv[kindAt + 1]
const venueAt = rawArgv.indexOf('--venue')
const venueArg = venueAt === -1 ? undefined : rawArgv[venueAt + 1]
const nameAt = rawArgv.indexOf('--name')
const nameArg = nameAt === -1 ? undefined : rawArgv[nameAt + 1]
const valueAt = new Set([configAt, kindAt, venueAt, nameAt].filter((i) => i !== -1).flatMap((i) => [i, i + 1]))
const argv = rawArgv.filter((_, i) => !valueAt.has(i))
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const [cmd, ...args] = argv.filter((a) => !a.startsWith('--'))

function usage(): never {
  console.error(`Usage:
  pnpm db:cli create-account <handle> <email> [--name <display name>] [--scout]
                                                        Create an account (a login); --scout makes it a scout
  pnpm db:cli create-organizer <name> <slug> <member_handle>
                                                        Create a verified organizer with an account as its owner
  pnpm db:cli add-member <organizer_slug> <handle>      Add an account as member of an organizer
  pnpm db:cli remove-member <organizer_slug> <handle>   Remove an account from an organizer
  pnpm db:cli set-scout <handle> on|off                 Turn the scout role of an account on or off
  pnpm db:cli set-email <handle> <email>                Change an account's login email
  pnpm db:cli api-key <handle>                          Generate (or reset) the API key for an account
  pnpm db:cli claim-event <event_id> <organizer_slug>   Make a verified organizer the creator of an unclaimed event
  pnpm db:cli copy-event <event_id> <YYYY-MM-DD> <title> [<YYYY-MM-DD> <title> ...] [--yes]
                                                        Copy an event to other days, one copy per date and title: same
                                                        Berlin times, venue, lineup, links, image and organizers
  pnpm db:cli delete-event <event_id> [--yes]           Hard-delete an event (removal requests, moderation)
  pnpm db:cli delete-account <handle> [--yes]           Delete an account: personal data goes, its events stay
  pnpm db:cli ingest-add-source <slug> <name> <url> <scout_handle> [--kind ical|dunckerclub|urbanspree|berghain|slaughterhouse|squarespace|schokoladen|festsaal|lido|supamolly|beateuwe|so36|frannz] [--config '<json>'] [--venue <venue_id>] [--unofficial]
                                                        Add a feed source (default: iCal) whose events a scout reviews;
                                                        --venue for the venue whose program it carries,
                                                        --unofficial for an aggregator, not the venue's own site
  pnpm db:cli ingest-set-venue <slug> <venue_id|none>   Link a feed source to the venue whose program it carries
  pnpm db:cli ingest-set-config <slug> --config '<json>'
                                                        Change a feed source's config: the given keys replace the stored ones
  pnpm db:cli ingest-list                               List feed sources: last run, last error, items per status
  pnpm db:cli ingest-disable <slug>                     Stop the daily run from fetching a source
  pnpm db:cli ingest-enable <slug>                      Let the daily run fetch a source again`)
  process.exit(1)
}

const isUuid = (s: string | undefined): s is string => !!s && /^[0-9a-f-]{36}$/i.test(s)

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`${question} y/N `)
  rl.close()
  return answer.trim().toLowerCase() === 'y'
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

/** The venue named by an id, or exits. */
async function findVenue(id: string): Promise<{ id: string; name: string }> {
  if (!isUuid(id)) fail(`Invalid venue id "${id}"`)
  const [venue] = await db.select({ id: venues.id, name: venues.name }).from(venues).where(eq(venues.id, id)).limit(1)
  if (!venue) fail(`No venue with id "${id}"`)
  return venue
}

/** --config as JSON, checked against the source config schema (defaults filled) but returned as given. */
function parseConfig(raw: string, base: Record<string, unknown> = {}): Record<string, unknown> {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    fail(`--config is not valid JSON: ${raw}`)
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) fail('--config must be a JSON object')
  const merged = { ...base, ...(json as Record<string, unknown>) }
  const parsed = ingestSourceConfigSchema.safeParse(merged)
  if (!parsed.success) {
    fail(`Invalid --config:\n${parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')}`)
  }
  // Stored as given: the pipeline fills in the defaults when it reads the config
  return merged
}

// Stored lowercased: magic-link login matches emails case-insensitively
function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`Invalid email "${raw}"`)
  return email
}

/** Handles and slugs: lowercase letters, digits and hyphens. Same rule as slugSchema in @open-event-db/shared. */
function checkSlug(value: string, what: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) || value.length > 100) {
    fail(`Invalid ${what} "${value}": use lowercase letters, digits and hyphens (no leading/trailing hyphen)`)
  }
}

async function findAccount(handle: string): Promise<{ id: string; handle: string; displayName: string; isScout: boolean }> {
  const [a] = await db
    .select({ id: accounts.id, handle: accounts.handle, displayName: accounts.displayName, isScout: accounts.isScout })
    .from(accounts)
    .where(eq(accounts.handle, handle))
    .limit(1)
  if (!a) fail(`No account with handle "${handle}"`)
  return a
}

async function findOrganizer(slug: string): Promise<{ id: string; name: string; slug: string; verified: boolean }> {
  const [o] = await db
    .select({ id: organizers.id, name: organizers.name, slug: organizers.slug, verified: organizers.verified })
    .from(organizers)
    .where(eq(organizers.slug, slug))
    .limit(1)
  if (!o) fail(`No organizer with slug "${slug}"`)
  return o
}

/** The account CLI actions for an organizer are logged under: its owner, else any member, else `fallback`. */
async function organizerActor(organizerId: string, fallback: string): Promise<string> {
  const [m] = await db
    .select({ accountId: organizerMembers.accountId })
    .from(organizerMembers)
    .where(eq(organizerMembers.organizerId, organizerId))
    .orderBy(sql`${organizerMembers.role} = 'owner' desc`)
    .limit(1)
  return m?.accountId ?? fallback
}

switch (cmd) {
  case 'create-account': {
    const [handle, rawEmail] = args
    if (!handle || !rawEmail) usage()
    if (nameAt !== -1 && nameArg === undefined) fail('--name needs a display name')
    checkSlug(handle, 'handle')
    const email = normalizeEmail(rawEmail)

    const [taken] = await db
      .select({ handle: accounts.handle })
      .from(accounts)
      .where(or(eq(accounts.handle, handle), sql`lower(${accounts.email}) = ${email}`))
      .limit(1)
    if (taken?.handle === handle) fail(`Handle "${handle}" is already taken`)
    if (taken) fail(`Email "${email}" is already used by account "${taken.handle}"`)

    // Scouts add and edit unclaimed events on behalf of organizers who aren't on the platform yet
    const scout = flags.has('--scout')
    const [a] = await db
      .insert(accounts)
      .values({ handle, email, displayName: nameArg?.trim() || handle, isScout: scout })
      .returning({ id: accounts.id, handle: accounts.handle })
    console.log(`Created ${scout ? 'scout ' : ''}account ${a?.handle} (${a?.id})`)
    break
  }
  case 'create-organizer': {
    const [name, slug, handle] = args
    if (!name || !slug || !handle) usage()
    checkSlug(slug, 'slug')
    const account = await findAccount(handle)
    const [taken] = await db.select({ id: organizers.id }).from(organizers).where(eq(organizers.slug, slug)).limit(1)
    if (taken) fail(`Organizer slug "${slug}" is already taken`)

    const o = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(organizers)
        .values({ name, slug, verified: true })
        .returning({ id: organizers.id, slug: organizers.slug })
      if (!row) throw new Error('insert returned no row')
      await tx.insert(organizerMembers).values({ organizerId: row.id, accountId: account.id, role: 'owner' })
      return row
    })
    console.log(`Created verified organizer ${o.slug} (${o.id}) with ${account.handle} as owner`)
    break
  }
  case 'add-member': {
    const [slug, handle] = args
    if (!slug || !handle) usage()
    const organizer = await findOrganizer(slug)
    const account = await findAccount(handle)
    const [existing] = await db
      .select({ role: organizerMembers.role })
      .from(organizerMembers)
      .where(and(eq(organizerMembers.organizerId, organizer.id), eq(organizerMembers.accountId, account.id)))
      .limit(1)
    if (existing) fail(`${account.handle} is already ${existing.role === 'owner' ? 'an owner' : 'a member'} of ${organizer.slug}`)
    await db.insert(organizerMembers).values({ organizerId: organizer.id, accountId: account.id, role: 'member' })
    console.log(`${account.handle} is now a member of ${organizer.slug}`)
    break
  }
  case 'remove-member': {
    const [slug, handle] = args
    if (!slug || !handle) usage()
    const organizer = await findOrganizer(slug)
    const account = await findAccount(handle)
    const removed = await db
      .delete(organizerMembers)
      .where(and(eq(organizerMembers.organizerId, organizer.id), eq(organizerMembers.accountId, account.id)))
      .returning({ accountId: organizerMembers.accountId })
    if (!removed.length) fail(`${account.handle} is not a member of ${organizer.slug}`)
    console.log(`${account.handle} is no longer a member of ${organizer.slug}`)
    const [left] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(organizerMembers)
      .where(eq(organizerMembers.organizerId, organizer.id))
    if (!left?.count) console.warn(`Warning: ${organizer.slug} has no members left`)
    break
  }
  case 'set-scout': {
    const [handle, state] = args
    if (!handle || (state !== 'on' && state !== 'off')) usage()
    const account = await findAccount(handle)
    await db
      .update(accounts)
      .set({ isScout: state === 'on', updatedAt: new Date() })
      .where(eq(accounts.id, account.id))
    console.log(`${account.handle} is ${state === 'on' ? 'now' : 'no longer'} a scout`)
    break
  }
  case 'set-email': {
    const [handle, rawEmail] = args
    if (!handle || !rawEmail) usage()
    const email = normalizeEmail(rawEmail)
    const [taken] = await db
      .select({ handle: accounts.handle })
      .from(accounts)
      .where(sql`lower(${accounts.email}) = ${email}`)
      .limit(1)
    if (taken && taken.handle !== handle) fail(`Email "${email}" is already used by account "${taken.handle}"`)
    const [a] = await db
      .update(accounts)
      .set({ email, updatedAt: new Date() })
      .where(eq(accounts.handle, handle))
      .returning({ handle: accounts.handle })
    if (!a) fail(`No account with handle "${handle}"`)
    console.log(`Login email for ${a.handle} is now ${email}`)
    break
  }
  case 'api-key': {
    const [handle] = args
    if (!handle) usage()
    const { key, hash } = generateApiKey()
    const [a] = await db
      .update(accounts)
      .set({ apiKeyHash: hash, updatedAt: new Date() })
      .where(eq(accounts.handle, handle))
      .returning({ handle: accounts.handle })
    if (!a) fail(`No account with handle "${handle}"`)
    console.log(`API key for ${a.handle} (shown once, previous key is now invalid):`)
    console.log(key)
    break
  }
  case 'claim-event': {
    const [id, slug] = args
    if (!isUuid(id) || !slug) usage()
    const [event] = await db
      .select({ title: events.title, createdBy: events.createdBy })
      .from(events)
      .where(eq(events.id, id))
      .limit(1)
    if (!event) fail(`No event with id "${id}"`)
    const organizer = await findOrganizer(slug)
    if (!organizer.verified) fail(`Organizer "${slug}" is not verified and cannot claim events`)

    const existing = await db
      .select({ name: organizers.name })
      .from(eventOrganizers)
      .innerJoin(organizers, eq(organizers.id, eventOrganizers.organizerId))
      .where(eq(eventOrganizers.eventId, id))
    if (existing.length) fail(`Event is already claimed by ${existing.map((o) => o.name).join(', ')}`)

    const actor = await organizerActor(organizer.id, event.createdBy)
    await db.transaction(async (tx) => {
      await tx.insert(eventOrganizers).values({ eventId: id, organizerId: organizer.id, role: 'creator' })
      // CLI actions log an account of the organizer as actor (its owner)
      await tx.insert(editHistory).values({
        entityType: 'event',
        entityId: id,
        accountId: actor,
        action: 'ownership_changed',
        diff: { organizers: { before: [], after: [organizer.id] }, via: 'cli' },
      })
      // A claimed event is no longer synced from a feed
      await tx
        .update(ingestItems)
        .set({ detachedAt: new Date() })
        .where(and(eq(ingestItems.eventId, id), isNull(ingestItems.detachedAt)))
    })
    console.log(`"${event.title}" is now claimed by ${organizer.name}`)
    break
  }
  case 'copy-event': {
    const [id, ...pairs] = args
    if (!isUuid(id) || pairs.length === 0 || pairs.length % 2) usage()
    const copies: { day: string; title: string }[] = []
    for (let i = 0; i < pairs.length; i += 2) {
      const day = pairs[i]!
      const title = pairs[i + 1]!.trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) fail(`Invalid date "${day}" (YYYY-MM-DD)`)
      if (!title) fail(`Empty title for ${day}`)
      copies.push({ day, title })
    }
    const [source] = await db.select().from(events).where(eq(events.id, id)).limit(1)
    if (!source) fail(`No event with id "${id}"`)
    const orgs = await db
      .select({ organizerId: eventOrganizers.organizerId, role: eventOrganizers.role, name: organizers.name })
      .from(eventOrganizers)
      .innerJoin(organizers, eq(organizers.id, eventOrganizers.organizerId))
      .where(eq(eventOrganizers.eventId, id))
    const creator = orgs.find((o) => o.role === 'creator')
    const actor = creator ? await organizerActor(creator.organizerId, source.createdBy) : source.createdBy

    console.log(`Copying "${source.title}" (organizers: ${orgs.map((o) => o.name).join(', ') || 'none, unclaimed'})`)
    for (const c of copies) console.log(`  ${c.day}  ${c.title}`)
    if (!flags.has('--yes') && !(await confirm('Create these events?'))) fail('Aborted')

    const tz = sql.raw(`'${EVENT_TZ}'`)
    // Same Berlin wall-clock times on the new day; an end on a later day keeps that many days' distance
    const startBerlin = sql`(${events.startsAt} at time zone ${tz})`
    const endBerlin = sql`(${events.endsAt} at time zone ${tz})`
    const created = await db.transaction(async (tx) => {
      const rows: { id: string; title: string; startsAt: string; endsAt: string | null }[] = []
      for (const c of copies) {
        const day = sql`${c.day}::date`
        const [row] = await tx.execute<{
          id: string
          title: string
          starts_at: string
          ends_at: string | null
          starts_berlin: string
          ends_berlin: string | null
        }>(sql`
          insert into events (title, description, lineup, starts_at, start_time_known, ends_at, venue_id, location_text,
            city, categories, tags, links, created_by, status, recurrence, image_key)
          select ${c.title}, description, lineup,
            (${day} + ${startBerlin}::time) at time zone ${tz},
            start_time_known,
            case when ends_at is null then null
              else (${day} + (${endBerlin}::date - ${startBerlin}::date) + ${endBerlin}::time) at time zone ${tz} end,
            venue_id, location_text, city, categories, tags, links, created_by, 'scheduled', recurrence, image_key
          from events where id = ${id}
          returning id, title, starts_at::text, ends_at::text,
            to_char(starts_at at time zone ${tz}, 'Dy DD.MM.YYYY HH24:MI') as starts_berlin,
            to_char(ends_at at time zone ${tz}, 'Dy DD.MM.YYYY HH24:MI') as ends_berlin`)
        if (!row) throw new Error('insert returned no row')
        if (orgs.length) {
          await tx.insert(eventOrganizers).values(orgs.map((o) => ({ eventId: row.id, organizerId: o.organizerId, role: o.role })))
        }
        // CLI actions log an account as actor: the creator organizer's owner, or who added the original
        await tx.insert(editHistory).values({
          entityType: 'event',
          entityId: row.id,
          accountId: actor,
          action: 'created',
          diff: {
            title: { before: null, after: row.title },
            starts_at: { before: null, after: row.starts_at },
            ends_at: { before: null, after: row.ends_at },
            copied_from: id,
            via: 'cli',
          },
        })
        rows.push({ id: row.id, title: row.title, startsAt: row.starts_berlin, endsAt: row.ends_berlin })
      }
      return rows
    })
    console.log('Created (Berlin time):')
    for (const e of created) console.log(`  ${e.id}  ${e.title}  ${e.startsAt}${e.endsAt ? ` → ${e.endsAt}` : ''}`)
    break
  }
  case 'delete-event': {
    const [id] = args
    if (!isUuid(id)) usage()
    const [event] = await db
      .select({ title: events.title, createdBy: events.createdBy, imageKey: events.imageKey })
      .from(events)
      .where(eq(events.id, id))
      .limit(1)
    if (!event) fail(`No event with id "${id}"`)

    const [creator] = await db
      .select({ id: organizers.id, name: organizers.name })
      .from(eventOrganizers)
      .innerJoin(organizers, eq(organizers.id, eventOrganizers.organizerId))
      .where(and(eq(eventOrganizers.eventId, id), eq(eventOrganizers.role, 'creator')))
      .limit(1)
    const actor = creator ? await organizerActor(creator.id, event.createdBy) : event.createdBy
    if (creator && !flags.has('--yes')) {
      const ok = await confirm(`Event "${event.title}" belongs to ${creator.name}. Delete anyway?`)
      if (!ok) fail('Aborted')
    }

    await db.transaction(async (tx) => {
      // Drop the content history too, otherwise the removed content would still be stored
      await tx
        .delete(editHistory)
        .where(and(eq(editHistory.entityType, 'event'), eq(editHistory.entityId, id)))
      await tx.delete(events).where(eq(events.id, id))
      await tx.insert(editHistory).values({
        entityType: 'event',
        entityId: id,
        accountId: actor,
        action: 'deleted',
        diff: { via: 'cli' },
      })
    })
    console.log(`Deleted event "${event.title}" (${id}); only a "deleted" history entry remains`)
    const notice = imageRemovalNotice(event.imageKey)
    if (notice) console.warn(`\n${notice}`)
    break
  }
  case 'delete-account': {
    const [handle] = args
    if (!handle) usage()
    const a = await findAccount(handle)
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .where(eq(events.createdBy, a.id))
    const count = row?.count ?? 0
    const memberships = await db
      .select({ organizerId: organizers.id, slug: organizers.slug })
      .from(organizerMembers)
      .innerJoin(organizers, eq(organizers.id, organizerMembers.organizerId))
      .where(eq(organizerMembers.accountId, a.id))
    if (!flags.has('--yes')) {
      const ok = await confirm(`Delete the account of ${a.displayName}? Their ${count} event(s) stay, without their name.`)
      if (!ok) fail('Aborted')
    }

    // Events, feed sources and edit history reference the account row (onDelete: restrict), so the row stays as
    // an anonymous placeholder: "Added by" then reads "Deleted account". Everything personal is removed.
    const orphaned: string[] = []
    await db.transaction(async (tx) => {
      await tx.delete(sessions).where(eq(sessions.accountId, a.id))
      await tx.delete(magicLinkTokens).where(eq(magicLinkTokens.accountId, a.id))
      await tx.delete(organizerMembers).where(eq(organizerMembers.accountId, a.id))
      for (const m of memberships) {
        const [left] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(organizerMembers)
          .where(eq(organizerMembers.organizerId, m.organizerId))
        if (!left?.count) orphaned.push(m.slug)
      }
      // Profile history holds their old names
      await tx
        .delete(editHistory)
        .where(and(eq(editHistory.entityType, 'account'), eq(editHistory.entityId, a.id)))
      await tx
        .update(accounts)
        .set({
          displayName: 'Deleted account',
          handle: `deleted-${a.id}`,
          // Unique and NOT NULL; the reserved .invalid TLD can never receive mail
          email: `deleted-${a.id}@invalid`,
          isScout: false,
          apiKeyHash: null,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, a.id))
      await tx.insert(editHistory).values({
        entityType: 'account',
        entityId: a.id,
        accountId: a.id,
        action: 'deleted',
        diff: { via: 'cli' },
      })
    })
    console.log(`Deleted the account of ${a.displayName} (${handle}); ${count} event(s) kept as "Deleted account"`)
    for (const slug of orphaned) {
      console.warn(`Warning: ${slug} has no members left; it stays public, without members`)
    }
    break
  }
  case 'ingest-add-source': {
    const [slug, name, feedUrl, scoutHandle] = args
    if (!slug || !name || !feedUrl || !scoutHandle) usage()
    if (configAt !== -1 && configArg === undefined) fail('--config needs a JSON value')
    const kinds = ingestSourceKind.enumValues
    const kind = kindArg ?? 'ical'
    if (!(kinds as readonly string[]).includes(kind)) fail(`--kind must be one of: ${kinds.join(', ')}`)
    // Same rule as slugSchema in @open-event-db/shared
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.length > 100) {
      fail(`Invalid slug "${slug}": use lowercase letters, digits and hyphens (no leading/trailing hyphen)`)
    }
    try {
      const protocol = new URL(feedUrl.replaceAll('{from}', '2000-01-01').replaceAll('{to}', '2000-01-02')).protocol
      if (protocol !== 'http:' && protocol !== 'https:') throw new Error('not http(s)')
    } catch {
      fail(`Invalid feed URL "${feedUrl}": it must be an http(s) URL ({from} and {to} are replaced by dates)`)
    }

    const config = configArg === undefined ? {} : parseConfig(configArg)
    if (venueAt !== -1 && venueArg === undefined) fail('--venue needs a venue id')
    const venue = venueArg === undefined ? undefined : await findVenue(venueArg)

    const scout = await findAccount(scoutHandle)
    if (!scout.isScout) fail(`"${scoutHandle}" is not a scout; sync edits must be attributed to a scout account`)

    const [taken] = await db.select({ id: ingestSources.id }).from(ingestSources).where(eq(ingestSources.slug, slug)).limit(1)
    if (taken) fail(`Source "${slug}" already exists`)

    const official = !flags.has('--unofficial')
    await db
      .insert(ingestSources)
      .values({
        slug,
        name,
        kind: kind as (typeof kinds)[number],
        url: feedUrl,
        accountId: scout.id,
        config,
        official,
        venueId: venue?.id,
      })
    console.log(`Added ${official ? 'official' : 'unofficial'} source ${slug} (${name}); edits are attributed to ${scoutHandle}`)
    if (venue) console.log(`  venue: ${venue.name}`)
    break
  }
  case 'ingest-set-venue': {
    const [slug, venueId] = args
    if (!slug || !venueId) usage()
    const venue = venueId === 'none' ? null : await findVenue(venueId)
    const [s] = await db
      .update(ingestSources)
      .set({ venueId: venue?.id ?? null, updatedAt: new Date() })
      .where(eq(ingestSources.slug, slug))
      .returning({ slug: ingestSources.slug })
    if (!s) fail(`No source with slug "${slug}"`)
    console.log(venue ? `Source ${s.slug} carries the program of ${venue.name}` : `Source ${s.slug} has no venue now`)
    break
  }
  case 'ingest-set-config': {
    const [slug] = args
    if (!slug || configArg === undefined) usage()
    const [source] = await db.select().from(ingestSources).where(eq(ingestSources.slug, slug)).limit(1)
    if (!source) fail(`No source with slug "${slug}"`)
    const config = parseConfig(configArg, source.config)
    await db.update(ingestSources).set({ config, updatedAt: new Date() }).where(eq(ingestSources.id, source.id))
    console.log(`Source ${slug} config: ${JSON.stringify(config)}`)
    break
  }
  case 'ingest-list': {
    const sources = await db
      .select({ s: ingestSources, venue: venues.name })
      .from(ingestSources)
      .leftJoin(venues, eq(venues.id, ingestSources.venueId))
      .orderBy(ingestSources.slug)
    if (!sources.length) {
      console.log('No feed sources yet. Add one with ingest-add-source.')
      break
    }
    const counts = await db
      .select({ sourceId: ingestItems.sourceId, status: ingestItems.status, count: sql<number>`count(*)::int` })
      .from(ingestItems)
      .groupBy(ingestItems.sourceId, ingestItems.status)
    for (const { s, venue } of sources) {
      const byStatus = new Map(counts.filter((c) => c.sourceId === s.id).map((c) => [c.status, c.count]))
      const items = (['pending', 'accepted', 'rejected'] as const).map((st) => `${st} ${byStatus.get(st) ?? 0}`).join(', ')
      console.log(`${s.slug}  ${s.kind}  ${s.enabled ? 'enabled' : 'disabled'}  ${s.official ? 'official' : 'unofficial'}  "${s.name}"`)
      console.log(`  venue:      ${venue ?? '-'}`)
      console.log(`  last run:   ${s.lastRunAt ? s.lastRunAt.toISOString() : 'never'}`)
      console.log(`  last error: ${s.lastError ?? '-'}`)
      console.log(`  items:      ${items}`)
    }
    break
  }
  case 'ingest-disable':
  case 'ingest-enable': {
    const [slug] = args
    if (!slug) usage()
    const enabled = cmd === 'ingest-enable'
    const [s] = await db
      .update(ingestSources)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(ingestSources.slug, slug))
      .returning({ slug: ingestSources.slug })
    if (!s) fail(`No source with slug "${slug}"`)
    console.log(`Source ${s.slug} is now ${enabled ? 'enabled' : 'disabled'}`)
    break
  }
  default:
    usage()
}

process.exit(0)

