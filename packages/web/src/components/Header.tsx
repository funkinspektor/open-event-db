import Link from 'next/link'
import { getCurrentPublisher } from '@/lib/session'
import { LogoutButton } from './LogoutButton'
import { UserMenu } from './UserMenu'

const menuItem =
  'block w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:text-neutral-400'

export async function Header() {
  const me = await getCurrentPublisher()

  return (
    <header className="border-b border-neutral-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-semibold tracking-tight sm:text-base">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-600" />
          Open Event Database
        </Link>
        <nav className="flex min-w-0 items-center gap-2 text-sm sm:gap-3">
          <Link href="/" className="hidden text-neutral-600 hover:text-neutral-900 sm:inline">
            Events
          </Link>
          <Link href="/venues" className="hidden text-neutral-600 hover:text-neutral-900 sm:inline">
            Venues
          </Link>
          {me ? (
            <>
              <Link
                href="/events/new"
                className="shrink-0 whitespace-nowrap rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-800"
              >
                <span className="sm:hidden">New</span>
                <span className="hidden sm:inline">Create event</span>
              </Link>
              <UserMenu name={me.name}>
                <Link href="/dashboard" className={menuItem}>Dashboard</Link>
                <Link href="/profile" className={menuItem}>Profile</Link>
                <div className="my-1 border-t border-neutral-100" />
                <LogoutButton className={menuItem} />
              </UserMenu>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-800 hover:bg-neutral-50"
            >
              Log in
            </Link>
          )}
        </nav>
      </div>
      <nav className="flex gap-5 border-t border-neutral-100 px-4 py-2 text-sm sm:hidden" aria-label="Sections">
        <Link href="/" className="text-neutral-600 hover:text-neutral-900">
          Events
        </Link>
        <Link href="/venues" className="text-neutral-600 hover:text-neutral-900">
          Venues
        </Link>
      </nav>
    </header>
  )
}
