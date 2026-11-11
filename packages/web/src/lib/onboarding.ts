import type { AccountMe } from '@open-event-db/shared'

// Reachable before onboarding is finished: the welcome flow itself, the goodbye page and the legal pages
// the terms checkbox links to.
const OPEN_PATHS = ['/welcome', '/goodbye', '/impressum', '/datenschutz', '/nutzungsbedingungen', '/lizenz']

/** True when a logged-in account hasn't finished /welcome yet and `pathname` (path + optional search) isn't exempt. */
export function needsWelcome(pathname: string, me: AccountMe | null): boolean {
  if (!me || me.onboarded) return false
  const path = pathname.split(/[?#]/)[0] ?? pathname
  if (path === '/_next' || path.startsWith('/_next/')) return false
  return !OPEN_PATHS.includes(path)
}
