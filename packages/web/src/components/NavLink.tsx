'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Header nav pill; the current section gets aria-current (surface-3 pill).
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const current =
    href === '/' ? pathname === '/' || pathname.startsWith('/events') : pathname.startsWith(href)
  return (
    <Link href={href} className="kk-nav__link" aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  )
}
