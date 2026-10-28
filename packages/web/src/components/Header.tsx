import Link from 'next/link'
import { getIngestCount } from '@/lib/api'
import { getCurrentPublisher, getSessionCookieHeader } from '@/lib/session'
import { Logo } from './Logo'
import { LogoutButton } from './LogoutButton'
import { NavLink } from './NavLink'
import { UserMenu } from './UserMenu'

// Pending items awaiting review; the nav link still renders if the count can't be loaded.
async function loadInboxCount(): Promise<number | null> {
  try {
    const cookie = await getSessionCookieHeader()
    if (!cookie) return null
    const { new: pending, gone } = await getIngestCount(cookie)
    return pending + gone
  } catch {
    return null
  }
}

// One sticky bar: logo, Events/Venues centred as a segmented control, account.
// Create event lives in the event list toolbar. On phones the wordmark and the account name drop out.
export async function Header() {
  const me = await getCurrentPublisher()
  const inboxCount = me?.is_scout ? await loadInboxCount() : null

  return (
    <header className="kk-header">
      <div className="kk-header__inner">
        <Logo />
        <nav className="kk-nav" aria-label="Main">
          <NavLink href="/">Events</NavLink>
          <NavLink href="/venues">Venues</NavLink>
          {me?.is_scout && (
            <NavLink href="/ingest">
              Inbox
              {inboxCount ? <span className="kk-pill__count">{inboxCount}</span> : null}
            </NavLink>
          )}
        </nav>
        <div className="kk-header__end">
          {me ? (
            <UserMenu name={me.name}>
              <Link href="/events/new" className="kk-menu__item">
                Create event
              </Link>
              <Link href="/dashboard" className="kk-menu__item">
                Dashboard
              </Link>
              <Link href="/profile" className="kk-menu__item">
                Profile
              </Link>
              <div className="kk-menu__sep" />
              <LogoutButton className="kk-menu__item" />
            </UserMenu>
          ) : (
            <Link href="/login" className="kk-btn kk-btn--light">
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
