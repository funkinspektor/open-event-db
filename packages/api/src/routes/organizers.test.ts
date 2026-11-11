import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { editHistory } from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { cleanup, createAccount, createOrganizer } from '../test/fixtures.js'

let app: FastifyInstance
const auth = (key: string) => ({ authorization: `Bearer ${key}` })

beforeAll(async () => {
  app = await buildApp({ logger: false })
})

afterAll(async () => {
  await cleanup()
  await app.close()
})

describe('organizers', () => {
  it('lists only verified organizers', async () => {
    const { account } = await createAccount({ organizer: false })
    const verified = await createOrganizer([account.id])
    const hidden = await createOrganizer([account.id], { verified: false })

    const list = await app.inject({ url: `/api/v1/organizers?q=${encodeURIComponent(verified.name)}` })
    expect(list.statusCode).toBe(200)
    const slugs = list.json().data.map((o: { slug: string }) => o.slug)
    expect(slugs).toContain(verified.slug)
    expect(slugs).not.toContain(hidden.slug)

    const ok = await app.inject({ url: `/api/v1/organizers/${verified.slug}` })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data).toMatchObject({ id: verified.id, upcoming_events: [] })
    const missing = await app.inject({ url: `/api/v1/organizers/${hidden.slug}` })
    expect(missing.statusCode).toBe(404)
  })

  it('members update their organizer, others get 403 not_a_member', async () => {
    const { key, organizer } = await createAccount()
    const other = await createAccount()

    const ok = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizers/${organizer!.slug}`,
      headers: auth(key),
      payload: { name: 'Renamed', links: { website: 'https://example.org' } },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data).toMatchObject({ name: 'Renamed', links: { website: 'https://example.org' } })

    const denied = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizers/${organizer!.slug}`,
      headers: auth(other.key),
      payload: { name: 'Hijacked' },
    })
    expect(denied.statusCode).toBe(403)
    expect(denied.json().error.code).toBe('not_a_member')

    const unknown = await app.inject({
      method: 'PUT',
      url: '/api/v1/organizers/does-not-exist-xyz',
      headers: auth(key),
      payload: { name: 'x' },
    })
    expect(unknown.statusCode).toBe(404)
  })

  it('members of an unverified organizer may still edit it', async () => {
    const { key, account } = await createAccount({ organizer: false })
    const org = await createOrganizer([account.id], { verified: false })
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizers/${org.slug}`,
      headers: auth(key),
      payload: { name: 'Still mine' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('rejects a taken slug with slug_taken', async () => {
    const { key, organizer } = await createAccount()
    const other = await createOrganizer([])
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizers/${organizer!.slug}`,
      headers: auth(key),
      payload: { slug: other.slug },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('slug_taken')

    const check = await app.inject({ url: `/api/v1/organizers/check-slug?slug=${other.slug}` })
    expect(check.json().data.available).toBe(false)
  })

  it('updates own handle, rejects a taken one with handle_taken', async () => {
    const { key, account } = await createAccount({ organizer: false })
    const other = await createAccount({ organizer: false })

    const newHandle = `${account.handle}-new`
    const ok = await app.inject({
      method: 'PUT',
      url: '/api/v1/accounts/me',
      headers: auth(key),
      payload: { handle: newHandle, display_name: 'New Name' },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data).toMatchObject({ handle: newHandle, display_name: 'New Name' })

    const taken = await app.inject({
      method: 'PUT',
      url: '/api/v1/accounts/me',
      headers: auth(key),
      payload: { handle: other.account.handle },
    })
    expect(taken.statusCode).toBe(400)
    expect(taken.json().error.code).toBe('handle_taken')

    const check = await app.inject({ url: `/api/v1/accounts/check-handle?handle=${other.account.handle}` })
    expect(check.json().data.available).toBe(false)
  })

  it('logs organizer edits as entity organizer with the account as actor', async () => {
    const { key, account, organizer } = await createAccount()
    await app.inject({
      method: 'PUT',
      url: `/api/v1/organizers/${organizer!.slug}`,
      headers: auth(key),
      payload: { name: 'Logged' },
    })
    const rows = await db
      .select()
      .from(editHistory)
      .where(and(eq(editHistory.entityId, organizer!.id), eq(editHistory.entityType, 'organizer')))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ accountId: account.id, action: 'updated' })
    expect(rows[0]!.diff).toHaveProperty('name')
  })

  it('creates an API key only from a session, not from a key', async () => {
    const { key } = await createAccount({ organizer: false })
    const res = await app.inject({ method: 'POST', url: '/api/v1/accounts/me/api-key', headers: auth(key) })
    expect(res.statusCode).toBe(403)
  })
})
