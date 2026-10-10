import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentPublisher } from '@/lib/session'
import { ProfileForm } from '@/components/ProfileForm'
import { ApiKeySection } from '@/components/ApiKeySection'

export const metadata: Metadata = { title: 'Profile' }

export default async function ProfilePage() {
  const me = await getCurrentPublisher()
  if (!me) redirect('/login')

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">Profile</p>
        <h1 className="text-3xl font-semibold tracking-tight">{me.name}</h1>
        <p className="mt-1 text-neutral-600">
          <Link href={`/publishers/${me.slug}`} className="underline-offset-2 hover:underline">
            View public profile →
          </Link>
        </p>
      </div>
      <ProfileForm me={me} />
      <ApiKeySection hasApiKey={me.has_api_key} />
    </div>
  )
}
