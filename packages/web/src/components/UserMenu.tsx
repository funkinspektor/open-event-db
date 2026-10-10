'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { ChevronIcon } from './Icons'

// Native <details> dropdown that also closes on item click, outside click,
// Escape and route change — the header stays mounted across client navigations.
export function UserMenu({ name, children }: { name: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  const pathname = usePathname()

  const close = () => {
    if (ref.current) ref.current.open = false
  }

  useEffect(close, [pathname])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current?.open) {
        close()
        ref.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <details ref={ref} className="kk-menu min-w-0">
      <summary className="kk-user" aria-label={`Account menu for ${name}`}>
        <span className="kk-user__avatar" aria-hidden>
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="hidden max-w-[10rem] truncate sm:inline">{name}</span>
        <ChevronIcon className="kk-icon shrink-0" style={{ width: 14, height: 14, strokeWidth: 2 }} />
      </summary>
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a, button:not(:disabled)')) close()
        }}
        className="kk-menu__list"
      >
        {children}
      </div>
    </details>
  )
}
