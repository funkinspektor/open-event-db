// Applies pending Drizzle migrations, then exits. The production container runs this before the server
// (see Dockerfile.api), so a deploy with a new migration needs no manual step. Locally `pnpm db:migrate`
// (drizzle-kit) does the same job.
import { fileURLToPath } from 'node:url'
import { ensureSuggestionsSource } from '@open-event-db/db'
import * as schema from '@open-event-db/db/schema'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL ?? 'postgres://oedb:oedb@localhost:5432/oedb'
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../../db/migrations', import.meta.url))

const client = postgres(url, { max: 1, onnotice: () => {} })
try {
  await migrate(drizzle(client), { migrationsFolder })
  // Not part of a migration: Postgres cannot use the 'suggestion' enum value in the transaction that added it
  await ensureSuggestionsSource(drizzle(client, { schema }))
  console.log(`migrations applied from ${migrationsFolder}`)
} finally {
  await client.end()
}
