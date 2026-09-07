import { Buffer } from 'node:buffer'

export function encodeCursor(payload: Record<string, string>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export function decodeCursor<T extends Record<string, string>>(value: string): T | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T
    return null
  } catch {
    return null
  }
}
