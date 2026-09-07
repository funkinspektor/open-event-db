import Link from 'next/link'
import { getCurrentPublisher } from '@/lib/session'
import { LogoutButton } from './LogoutButton'

const menuItem =
  'block w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:text-neutral-400'

export async function Header() {
  const me = await getCurrentPublisher()

  return (
    <header className="border-b border-neutral-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-600" />
          Open Event Database
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/" className="text-neutral-600 hover:text-neutral-900">
            Events
          </Link>
          {me ? (
            <>
              <Link
                href="/events/new"
                className="rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-800"
              >
                Create event
              </Link>
              <details className="group relative">
                <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-800 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
                  <span className="max-w-[10rem] truncate">{me.name}</span>
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-neutral-500" aria-hidden>
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                  </svg>
                </summary>
                <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
                  <Link href="/dashboard" className={menuItem}>Dashboard</Link>
                  <button type="button" disabled className={menuItem} title="Coming soon">Profile</button>
                  <button type="button" disabled className={menuItem} title="Coming soon">Invites</button>
                  <div className="my-1 border-t border-neutral-100" />
                  <LogoutButton className={menuItem} />
                </div>
              </details>
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
    </header>
  )
}
