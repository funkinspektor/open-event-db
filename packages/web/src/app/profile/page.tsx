import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getOrganizer } from '@/lib/api'
import { getCurrentAccount } from '@/lib/session'
import { AccountForm } from '@/components/AccountForm'
import { OrganizerForm } from '@/components/OrganizerForm'
import { ApiKeySection } from '@/components/ApiKeySection'
import { EmailChangeForm } from '@/components/EmailChangeForm'
import { DeleteAccountSection } from '@/components/DeleteAccountSection'
import { Headline } from '@/components/Headline'
import { NextIcon } from '@/components/Icons'

export const metadata: Metadata = { title: 'Profile' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function ProfilePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  const emailResult = sp.email === 'changed' || sp.email === 'taken' ? sp.email : undefined
  const me = await getCurrentAccount()
  if (!me) redirect('/login')

  // Links live on the public organizer record; an unverified organizer has no public page, so none to load.
  const organizers = await Promise.all(
    me.organizers.map(async (m) => ({ m, links: m.verified ? ((await getOrganizer(m.slug))?.links ?? null) : null })),
  )

  return (
    <div className="kk-container kk-container--narrow" style={{ maxWidth: 720 }}>
      <section className="kk-intro" style={{ gap: 12 }}>
        <p className="kk-eyebrow">Profile</p>
        <Headline text={me.display_name} narrow />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="kk-section-title">Your account</h2>
        <AccountForm me={me} />
        <EmailChangeForm email={me.email} result={emailResult} />
      </section>

      {organizers.map(({ m, links }) => (
        <section key={m.id} className="flex flex-col gap-4">
          <h2 className="kk-section-title">{m.name}</h2>
          <p className="m-0 flex flex-wrap items-center gap-x-4 text-body text-muted">
            <span>{m.role === 'owner' ? 'You are an owner of this organizer.' : 'You are a member of this organizer.'}</span>
            {m.verified ? (
              <Link href={`/organizers/${m.slug}`} className="text-body text-muted">
                View public page
                <NextIcon />
              </Link>
            ) : (
              <span>Awaiting verification. It has no public page yet.</span>
            )}
          </p>
          <OrganizerForm key={m.id} organizer={m} links={links} />
        </section>
      ))}

      <ApiKeySection hasApiKey={me.has_api_key} />

      <DeleteAccountSection handle={me.handle} />
    </div>
  )
}
