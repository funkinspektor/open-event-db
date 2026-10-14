// Applies pending Drizzle migrations, then exits. The production container runs this before the server
// (see Dockerfile.api), so a deploy with a new migration needs no manual step. Locally `pnpm db:migrate`
// (drizzle-kit) does the same job.
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL ?? 'postgres://oedb:oedb@localhost:5432/oedb'
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../../db/migrations', import.meta.url))

const client = postgres(url, { max: 1, onnotice: () => {} })
try {
  await migrate(drizzle(client), { migrationsFolder })
  console.log(`migrations applied from ${migrationsFolder}`)
} finally {
  await client.end()
}
