import { cache } from 'react'
import { cookies } from 'next/headers'
import type { PublisherMe } from '@open-event-db/shared'
import { getMe } from './api'

export const SESSION_COOKIE = 'oedb_session'

export const getCurrentPublisher = cache(async (): Promise<PublisherMe | null> => {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  try {
    return await getMe(`${SESSION_COOKIE}=${token}`)
  } catch {
    return null
  }
})
