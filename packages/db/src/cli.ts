import { and, eq, or, sql } from 'drizzle-orm'
import { createDb } from './index.js'
import { editHistory, events, publishers } from './schema.js'
import { generateApiKey } from './tokens.js'

const url = process.env.DATABASE_URL ?? 'postgres://oedb:oedb@localhost:5432/oedb'
const db = createDb(url)

const [cmd, ...args] = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"))

function usage(): never {
  console.error(`Usage:
  pnpm db:cli create-publisher <name> <slug> <email>   Create a verified seed publisher
  pnpm db:cli set-email <slug> <email>                  Change a publisher's login email
  pnpm db:cli api-key <slug>                            Generate (or reset) the API key for a publisher
  pnpm db:cli delete-event <id>                         Hard-delete an event incl. owners and edit history (dev/testing only)`)
  process.exit(1)
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

    const [p] = await db
      .insert(publishers)
      .values({ name, slug, email, verified: true })
      .returning({ id: publishers.id, slug: publishers.slug })
    console.log(`Created publisher ${p?.slug} (${p?.id})`)
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
  case 'delete-event': {
    const [id] = args
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) usage()
    const [deleted] = await db.transaction(async (tx) => {
      await tx
        .delete(editHistory)
        .where(and(eq(editHistory.entityType, 'event'), eq(editHistory.entityId, id)))
      return tx.delete(events).where(eq(events.id, id)).returning({ title: events.title })
    })
    if (!deleted) {
      console.error(`No event with id "${id}"`)
      process.exit(1)
    }
    console.log(`Deleted event "${deleted.title}" (${id}) with its owners and edit history`)
    break
  }
  default:
    usage()
}

process.exit(0)
