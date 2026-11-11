import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { safeReturnTo } from '@open-event-db/shared'
import { getCurrentAccount } from '@/lib/session'
import { LoginForm } from '@/components/LoginForm'
import { Headline } from '@/components/Headline'

export const metadata: Metadata = { title: 'Log in' }

const ERRORS: Record<string, string> = {
  expired: 'This login link has expired or was already used. Request a new one below.',
  invalid: 'This login link is not valid. Request a new one below.',
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  const returnTo = safeReturnTo(typeof sp.return_to === 'string' ? sp.return_to : undefined) ?? undefined

  const me = await getCurrentAccount()
  if (me) redirect(returnTo ?? '/dashboard')

  const errorKey = typeof sp.error === 'string' ? sp.error : undefined
  const error = errorKey ? ERRORS[errorKey] : undefined

  return (
    <div className="kk-container w-full" style={{ maxWidth: 480, paddingTop: 80, gap: 28 }}>
      <section className="kk-intro" style={{ gap: 14 }}>
        <Headline text="Log in" narrow />
        <p className="kk-lede">Log in or sign up — we’ll email you a link.</p>
      </section>
      {error && (
        <div role="alert" className="kk-alert font-medium">
          {error}
        </div>
      )}
      <LoginForm returnTo={returnTo} />
    </div>
  )
}
