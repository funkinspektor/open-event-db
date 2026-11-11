import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { safeReturnTo } from '@open-event-db/shared'
import { getCurrentAccount } from '@/lib/session'
import { WelcomeForm } from '@/components/WelcomeForm'
import { Headline } from '@/components/Headline'

export const metadata: Metadata = { title: 'Welcome' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function WelcomePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  const returnTo = safeReturnTo(typeof sp.return_to === 'string' ? sp.return_to : undefined)

  const me = await getCurrentAccount()
  if (!me) redirect('/login')
  if (me.onboarded) redirect(returnTo ?? '/')

  return (
    <div className="kk-container w-full" style={{ maxWidth: 480, paddingTop: 80, gap: 28 }}>
      <section className="kk-intro" style={{ gap: 14 }}>
        <Headline text="Welcome to Kellerkompass" narrow />
        <p className="kk-lede">Pick a name and a handle, then you’re in.</p>
      </section>
      <WelcomeForm initialName={me.display_name} returnTo={returnTo ?? undefined} />
    </div>
  )
}
