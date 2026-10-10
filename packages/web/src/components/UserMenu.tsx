'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

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
    <details ref={ref} className="group relative min-w-0">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-800 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
        <span className="max-w-[6rem] truncate sm:max-w-[10rem]">{name}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </summary>
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a, button:not(:disabled)')) close()
        }}
        className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
      >
        {children}
      </div>
    </details>
  )
}
