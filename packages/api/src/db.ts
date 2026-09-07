import { createDb } from '@open-event-db/db'

const url = process.env.DATABASE_URL ?? 'postgres://oedb:oedb@localhost:5432/oedb'

export const db = createDb(url)
