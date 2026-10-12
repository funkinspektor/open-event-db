import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentPublisher } from '@/lib/session'
import { ProfileForm } from '@/components/ProfileForm'
import { ApiKeySection } from '@/components/ApiKeySection'
import { Headline } from '@/components/Headline'
import { NextIcon } from '@/components/Icons'

export const metadata: Metadata = { title: 'Profile' }

export default async function ProfilePage() {
  const me = await getCurrentPublisher()
  if (!me) redirect('/login')

  return (
    <div className="kk-container kk-container--narrow" style={{ maxWidth: 720 }}>
      <section className="kk-intro" style={{ gap: 12 }}>
        <p className="kk-eyebrow">Profile</p>
        <Headline text={me.name} narrow />
        {/* Pure scouts have no public profile page yet (Scout PRD P1) */}
        {me.is_publisher && (
          <Link href={`/publishers/${me.slug}`} className="text-body text-muted">
            View public profile
            <NextIcon />
          </Link>
        )}
      </section>
      <ProfileForm me={me} />
      <ApiKeySection hasApiKey={me.has_api_key} />
    </div>
  )
}
