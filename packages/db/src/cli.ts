import { eq } from 'drizzle-orm'
import { createDb } from './index.js'
import { publishers } from './schema.js'
import { generateApiKey } from './tokens.js'

const url = process.env.DATABASE_URL ?? 'postgres://oedb:oedb@localhost:5432/oedb'
const db = createDb(url)

const [cmd, ...args] = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"))

function usage(): never {
  console.error(`Usage:
  pnpm db:cli create-publisher <name> <slug> <email>   Create a verified seed publisher
  pnpm db:cli api-key <slug>                            Generate (or reset) the API key for a publisher`)
  process.exit(1)
}

switch (cmd) {
  case 'create-publisher': {
    const [name, slug, email] = args
    if (!name || !slug || !email) usage()
    const [p] = await db
      .insert(publishers)
      .values({ name, slug, email, verified: true })
      .returning({ id: publishers.id, slug: publishers.slug })
    console.log(`Created publisher ${p?.slug} (${p?.id})`)
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
  default:
    usage()
}

process.exit(0)
