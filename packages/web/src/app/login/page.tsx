import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentPublisher } from '@/lib/session'
import { LoginForm } from '@/components/LoginForm'
import { Headline } from '@/components/Headline'

export const metadata: Metadata = { title: 'Log in' }

const ERRORS: Record<string, string> = {
  expired: 'This login link has expired or was already used. Request a new one below.',
  invalid: 'This login link is not valid. Request a new one below.',
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await getCurrentPublisher()
  if (me) redirect('/dashboard')

  const sp = await searchParams
  const errorKey = typeof sp.error === 'string' ? sp.error : undefined
  const error = errorKey ? ERRORS[errorKey] : undefined

  return (
    <div className="kk-container w-full" style={{ maxWidth: 480, paddingTop: 80, gap: 28 }}>
      <section className="kk-intro" style={{ gap: 14 }}>
        <Headline text="Log in" narrow />
        <p className="kk-lede">For publishers. Enter the email you registered with.</p>
      </section>
      {error && (
        <div role="alert" className="kk-alert font-medium">
          {error}
        </div>
      )}
      <LoginForm />
    </div>
  )
}
