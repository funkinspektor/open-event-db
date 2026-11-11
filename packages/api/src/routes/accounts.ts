import type { FastifyInstance } from 'fastify'
import { eq, sql } from 'drizzle-orm'
import { accountUpdateSchema, checkHandleQuerySchema } from '@open-event-db/shared'
import { accounts, generateApiKey, type Account } from '@open-event-db/db'
import { db } from '../db.js'
import { badRequest } from '../errors.js'
import { currentAccount, requireAuth, requireSession, writeRateLimit } from '../auth.js'
import { diff, logEdit } from '../history.js'

const write = { onRequest: requireAuth, config: { rateLimit: writeRateLimit } }

function serializeAccount(a: Account) {
  return { id: a.id, handle: a.handle, display_name: a.displayName }
}

function accountSnapshot(a: Account): Record<string, unknown> {
  return { handle: a.handle, display_name: a.displayName }
}

export async function accountRoutes(app: FastifyInstance) {
  app.get('/accounts/check-handle', async (req) => {
    const { handle } = checkHandleQuerySchema.parse(req.query)
    const [row] = await db
      .select({ exists: sql<boolean>`true` })
      .from(accounts)
      .where(eq(accounts.handle, handle))
      .limit(1)
    return { data: { available: !row } }
  })

  app.put('/accounts/me', write, async (req) => {
    const me = currentAccount(req)
    const body = accountUpdateSchema.parse(req.body)

    const patch: Partial<typeof accounts.$inferInsert> = {}
    if (body.display_name !== undefined) patch.displayName = body.display_name
    if (body.handle !== undefined && body.handle !== me.handle) {
      const [taken] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.handle, body.handle))
        .limit(1)
      if (taken) throw badRequest('This handle is already taken', 'handle_taken')
      patch.handle = body.handle
    }
    if (Object.keys(patch).length === 0) return { data: serializeAccount(me) }

    const updated = await db.transaction(async (tx) => {
      const [a] = await tx
        .update(accounts)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(accounts.id, me.id))
        .returning()
      if (!a) throw new Error('update returned no row')
      await logEdit(tx, {
        entityType: 'account',
        entityId: me.id,
        accountId: me.id,
        action: 'updated',
        diff: diff(accountSnapshot(me), accountSnapshot(a)),
      })
      return a
    })

    return { data: serializeAccount(updated) }
  })

  app.post(
    '/accounts/me/api-key',
    { onRequest: requireSession, config: { rateLimit: writeRateLimit } },
    async (req, reply) => {
      const me = currentAccount(req)
      const { key, hash } = generateApiKey()
      await db
        .update(accounts)
        .set({ apiKeyHash: hash, updatedAt: new Date() })
        .where(eq(accounts.id, me.id))
      reply.status(201)
      return { data: { api_key: key } }
    },
  )
}
