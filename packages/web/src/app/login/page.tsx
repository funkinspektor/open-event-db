import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentPublisher } from '@/lib/session'
import { LoginForm } from '@/components/LoginForm'

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
    <div className="mx-auto max-w-md space-y-6 py-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Log in</h1>
        <p className="mt-2 text-neutral-600">For publishers. Enter the email you registered with.</p>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      )}
      <LoginForm />
    </div>
  )
}
