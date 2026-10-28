import { createInterface } from 'node:readline/promises'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { createDb } from './index.js'
import {
  editHistory,
  eventOwners,
  events,
  ingestItems,
  ingestSourceKind,
  ingestSources,
  invites,
  magicLinkTokens,
  publishers,
  sessions,
} from './schema.js'
import { generateApiKey } from './tokens.js'
import { imageRemovalNotice } from './images.js'

const url = process.env.DATABASE_URL ?? 'postgres://oedb:oedb@localhost:5432/oedb'
const db = createDb(url)

const rawArgv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"))
// --config and --kind take the next argument as their value, so they are pulled out before the bare flags are sorted
const configAt = rawArgv.indexOf('--config')
const configArg = configAt === -1 ? undefined : rawArgv[configAt + 1]
const kindAt = rawArgv.indexOf('--kind')
const kindArg = kindAt === -1 ? undefined : rawArgv[kindAt + 1]
const valueAt = new Set([configAt, kindAt].filter((i) => i !== -1).flatMap((i) => [i, i + 1]))
const argv = rawArgv.filter((_, i) => !valueAt.has(i))
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const [cmd, ...args] = argv.filter((a) => !a.startsWith('--'))

function usage(): never {
  console.error(`Usage:
  pnpm db:cli create-publisher <name> <slug> <email> [--scout]
                                                        Create a verified publisher (or, with --scout, a scout)
  pnpm db:cli set-email <slug> <email>                  Change a publisher's login email
  pnpm db:cli api-key <slug>                            Generate (or reset) the API key for a publisher
  pnpm db:cli claim-event <event_id> <publisher_slug>   Make a publisher the creator of an unclaimed event
  pnpm db:cli delete-event <event_id> [--yes]           Hard-delete an event (removal requests, moderation)
  pnpm db:cli delete-publisher <slug> [--yes]           Delete an account: personal data goes, its events stay
  pnpm db:cli ingest-add-source <slug> <name> <url> <scout_slug> [--kind ical|dunckerclub] [--config '<json>']
                                                        Add a feed source (default: iCal) whose events a scout reviews
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

// Stored lowercased: magic-link login matches emails case-insensitively
function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`Invalid email "${raw}"`)
  return email
}

switch (cmd) {
  case 'create-publisher': {
    const [name, slug, rawEmail] = args
    if (!name || !slug || !rawEmail) usage()
    // Same rule as slugSchema in @open-event-db/shared
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.length > 100) {
      fail(`Invalid slug "${slug}": use lowercase letters, digits and hyphens (no leading/trailing hyphen)`)
    }
    const email = normalizeEmail(rawEmail)

    const [taken] = await db
      .select({ slug: publishers.slug, email: publishers.email })
      .from(publishers)
      .where(or(eq(publishers.slug, slug), sql`lower(${publishers.email}) = ${email}`))
      .limit(1)
    if (taken?.slug === slug) fail(`Slug "${slug}" is already taken`)
    if (taken) fail(`Email "${email}" is already used by publisher "${taken.slug}"`)

    // Scouts curate events for organizers who aren't on the platform; they never own events.
    // Scouts are always verified — the role is trust-gated by definition.
    const scout = flags.has('--scout')
    const [p] = await db
      .insert(publishers)
      .values({ name, slug, email, verified: true, isPublisher: !scout, isScout: scout })
      .returning({ id: publishers.id, slug: publishers.slug })
    console.log(`Created ${scout ? 'scout' : 'publisher'} ${p?.slug} (${p?.id})`)
    break
  }
  case 'set-email': {
    const [slug, rawEmail] = args
    if (!slug || !rawEmail) usage()
    const email = normalizeEmail(rawEmail)
    const [taken] = await db
      .select({ slug: publishers.slug })
      .from(publishers)
      .where(sql`lower(${publishers.email}) = ${email}`)
      .limit(1)
    if (taken && taken.slug !== slug) fail(`Email "${email}" is already used by publisher "${taken.slug}"`)
    const [p] = await db
      .update(publishers)
      .set({ email, updatedAt: new Date() })
      .where(eq(publishers.slug, slug))
      .returning({ slug: publishers.slug })
    if (!p) fail(`No publisher with slug "${slug}"`)
    console.log(`Login email for ${p.slug} is now ${email}`)
    break
  }
  case 'api-key': {
    const [slug] = args
    if (!slug) usage()
    const { key, hash } = generateApiKey()
    const [p] = await db
      .update(publishers)
      .set({ apiKeyHash: hash, updatedAt: new Date() })
      .where(eq(publishers.slug, slug))
      .returning({ slug: publishers.slug })
    if (!p) {
      console.error(`No publisher with slug "${slug}"`)
      process.exit(1)
    }
    console.log(`API key for ${p.slug} (shown once, previous key is now invalid):`)
    console.log(key)
    break
  }
  case 'claim-event': {
    const [id, slug] = args
    if (!isUuid(id) || !slug) usage()
    const [event] = await db.select({ title: events.title }).from(events).where(eq(events.id, id)).limit(1)
    if (!event) fail(`No event with id "${id}"`)
    const [p] = await db
      .select({ id: publishers.id, name: publishers.name, isPublisher: publishers.isPublisher })
      .from(publishers)
      .where(eq(publishers.slug, slug))
      .limit(1)
    if (!p) fail(`No publisher with slug "${slug}"`)
    if (!p.isPublisher) fail(`"${slug}" is a scout account and cannot own events`)

    const owners = await db
      .select({ name: publishers.name })
      .from(eventOwners)
      .innerJoin(publishers, eq(publishers.id, eventOwners.publisherId))
      .where(eq(eventOwners.eventId, id))
    if (owners.length) fail(`Event is already claimed by ${owners.map((o) => o.name).join(', ')}`)

    await db.transaction(async (tx) => {
      await tx.insert(eventOwners).values({ eventId: id, publisherId: p.id, role: 'creator' })
      // CLI actions log the affected publisher as actor
      await tx.insert(editHistory).values({
        entityType: 'event',
        entityId: id,
        publisherId: p.id,
        action: 'ownership_changed',
        diff: { owners: { before: [], after: [p.id] }, via: 'cli' },
      })
      // A claimed event is no longer synced from a feed
      await tx
        .update(ingestItems)
        .set({ detachedAt: new Date() })
        .where(and(eq(ingestItems.eventId, id), isNull(ingestItems.detachedAt)))
    })
    console.log(`"${event.title}" is now claimed by ${p.name}`)
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
      .select({ id: publishers.id, name: publishers.name })
      .from(eventOwners)
      .innerJoin(publishers, eq(publishers.id, eventOwners.publisherId))
      .where(and(eq(eventOwners.eventId, id), eq(eventOwners.role, 'creator')))
      .limit(1)
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
        publisherId: creator?.id ?? event.createdBy,
        action: 'deleted',
        diff: { via: 'cli' },
      })
    })
    console.log(`Deleted event "${event.title}" (${id}); only a "deleted" history entry remains`)
    const notice = imageRemovalNotice(event.imageKey)
    if (notice) console.warn(`\n${notice}`)
    break
  }
  case 'delete-publisher': {
    const [slug] = args
    if (!slug) usage()
    const [p] = await db
      .select({ id: publishers.id, name: publishers.name })
      .from(publishers)
      .where(eq(publishers.slug, slug))
      .limit(1)
    if (!p) fail(`No publisher with slug "${slug}"`)
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .where(eq(events.createdBy, p.id))
    const count = row?.count ?? 0
    if (!flags.has('--yes')) {
      const ok = await confirm(`Delete the account of ${p.name}? Their ${count} event(s) stay, without their name.`)
      if (!ok) fail('Aborted')
    }

    // Events and edit history reference the publisher row (onDelete: restrict), so the row stays as an
    // anonymous placeholder: "Added by" then reads "Deleted account". Everything personal is removed.
    await db.transaction(async (tx) => {
      await tx.delete(sessions).where(eq(sessions.publisherId, p.id))
      await tx.delete(magicLinkTokens).where(eq(magicLinkTokens.publisherId, p.id))
      // Their events stay but lose them as owner; events they created alone become unclaimed
      await tx.delete(eventOwners).where(eq(eventOwners.publisherId, p.id))
      // Invites they sent hold other people's emails
      await tx.delete(invites).where(eq(invites.invitedBy, p.id))
      await tx.update(invites).set({ claimedBy: null }).where(eq(invites.claimedBy, p.id))
      // Profile history holds their old names and links
      await tx
        .delete(editHistory)
        .where(and(eq(editHistory.entityType, 'publisher'), eq(editHistory.entityId, p.id)))
      await tx
        .update(publishers)
        .set({
          name: 'Deleted account',
          slug: `deleted-${p.id.slice(0, 8)}`,
          // Unique and NOT NULL; the reserved .invalid TLD can never receive mail
          email: `deleted-${p.id}@deleted.invalid`,
          verified: false,
          isPublisher: false,
          isScout: false,
          invitedBy: null,
          apiKeyHash: null,
          links: {},
          updatedAt: new Date(),
        })
        .where(eq(publishers.id, p.id))
      await tx.insert(editHistory).values({
        entityType: 'publisher',
        entityId: p.id,
        publisherId: p.id,
        action: 'deleted',
        diff: { via: 'cli' },
      })
    })
    console.log(`Deleted the account of ${p.name}; ${count} event(s) kept as "Deleted account"`)
    break
  }
  case 'ingest-add-source': {
    const [slug, name, feedUrl, scoutSlug] = args
    if (!slug || !name || !feedUrl || !scoutSlug) usage()
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

    let config: Record<string, unknown> = {}
    if (configArg !== undefined) {
      let json: unknown
      try {
        json = JSON.parse(configArg)
      } catch {
        fail(`--config is not valid JSON: ${configArg}`)
      }
      const parsed = ingestSourceConfigSchema.safeParse(json)
      if (!parsed.success) {
        fail(`Invalid --config:\n${parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')}`)
      }
      // Stored as given: the pipeline fills in the defaults when it reads the config
      config = json as Record<string, unknown>
    }

    const [scout] = await db
      .select({ id: publishers.id, isScout: publishers.isScout })
      .from(publishers)
      .where(eq(publishers.slug, scoutSlug))
      .limit(1)
    if (!scout) fail(`No publisher with slug "${scoutSlug}"`)
    if (!scout.isScout) fail(`"${scoutSlug}" is not a scout; sync edits must be attributed to a scout account`)

    const [taken] = await db.select({ id: ingestSources.id }).from(ingestSources).where(eq(ingestSources.slug, slug)).limit(1)
    if (taken) fail(`Source "${slug}" already exists`)

    await db.insert(ingestSources).values({ slug, name, kind: kind as (typeof kinds)[number], url: feedUrl, publisherId: scout.id, config })
    console.log(`Added source ${slug} (${name}); edits are attributed to ${scoutSlug}`)
    break
  }
  case 'ingest-list': {
    const sources = await db.select().from(ingestSources).orderBy(ingestSources.slug)
    if (!sources.length) {
      console.log('No feed sources yet. Add one with ingest-add-source.')
      break
    }
    const counts = await db
      .select({ sourceId: ingestItems.sourceId, status: ingestItems.status, count: sql<number>`count(*)::int` })
      .from(ingestItems)
      .groupBy(ingestItems.sourceId, ingestItems.status)
    for (const s of sources) {
      const byStatus = new Map(counts.filter((c) => c.sourceId === s.id).map((c) => [c.status, c.count]))
      const items = (['pending', 'accepted', 'rejected'] as const).map((st) => `${st} ${byStatus.get(st) ?? 0}`).join(', ')
      console.log(`${s.slug}  ${s.kind}  ${s.enabled ? 'enabled' : 'disabled'}  "${s.name}"`)
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
