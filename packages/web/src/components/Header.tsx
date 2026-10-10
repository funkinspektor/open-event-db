import Link from 'next/link'
import { getCurrentPublisher } from '@/lib/session'
import { Logo } from './Logo'
import { LogoutButton } from './LogoutButton'
import { NavLink } from './NavLink'
import { UserMenu } from './UserMenu'

export async function Header() {
  const me = await getCurrentPublisher()

  return (
    <header className="kk-header w-full">
      <Logo />
      <nav className="kk-nav" aria-label="Main">
        <NavLink href="/">Events</NavLink>
        <NavLink href="/venues">Venues</NavLink>
        {me ? (
          <>
            <Link href="/events/new" className="kk-btn kk-btn--primary whitespace-nowrap">
              <span className="sm:hidden">New</span>
              <span className="hidden sm:inline">Create event</span>
            </Link>
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
          </>
        ) : (
          <Link href="/login" className="kk-btn kk-btn--light">
            Log in
          </Link>
        )}
      </nav>
    </header>
  )
}
