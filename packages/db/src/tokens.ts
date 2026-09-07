import { createHash, randomBytes } from 'node:crypto'

export const API_KEY_PREFIX = 'oevt_'

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function generateApiKey(): { key: string; hash: string } {
  const key = API_KEY_PREFIX + randomBytes(24).toString('base64url').slice(0, 32)
  return { key, hash: sha256(key) }
}

export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: sha256(token) }
}
