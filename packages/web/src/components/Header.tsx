import Link from 'next/link'
import { getCurrentPublisher } from '@/lib/session'
import { Logo } from './Logo'
import { LogoutButton } from './LogoutButton'
import { NavLink } from './NavLink'
import { UserMenu } from './UserMenu'

// Desktop: logo, nav pills, Create event, account. Phones: one sticky bar with the mark,
// Events/Venues as a centred segmented control and the account; Create event moves to the list toolbar.
export async function Header() {
  const me = await getCurrentPublisher()

  return (
    <header className="kk-header w-full">
      <Logo />
      <nav className="kk-nav" aria-label="Main">
        <NavLink href="/">Events</NavLink>
        <NavLink href="/venues">Venues</NavLink>
      </nav>
      <div className="kk-header__end">
        {/* Shown logged out too: /events/new sends visitors to log in. */}
        <Link href="/events/new" className="kk-btn kk-btn--primary kk-header__create whitespace-nowrap">
          Create event
        </Link>
        {me ? (
          <UserMenu name={me.name}>
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
    </header>
  )
}
