'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { AccountMe } from '@open-event-db/shared'
import { needsWelcome } from '@/lib/onboarding'

/**
 * Client-side half of the onboarding gate. The root layout redirects on full page loads, but it isn't
 * re-rendered on client navigations, so a <Link> click could otherwise slip past it.
 */
export function OnboardingGate({ me }: { me: AccountMe }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams().toString()
  const path = pathname + (search ? `?${search}` : '')

  useEffect(() => {
    if (needsWelcome(path, me)) router.replace('/welcome?return_to=' + encodeURIComponent(path))
  }, [path, me, router])

  return null
}
