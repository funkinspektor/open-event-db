import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTags } from '@/lib/api'
import { getCurrentPublisher } from '@/lib/session'
import { NewEventForm } from '@/components/NewEventForm'
import { Headline } from '@/components/Headline'

export const metadata: Metadata = { title: 'Create event' }

export default async function NewEventPage() {
  const me = await getCurrentPublisher()
  if (!me) redirect('/login')

  const tags = await getTags()

  return (
    <div className="kk-container kk-container--narrow">
      <section className="kk-intro" style={{ gap: 12 }}>
        <p className="kk-eyebrow">New event</p>
        <Headline text="Create event" narrow />
        <p className="kk-lede max-w-none">Published as {me.name}. Live on the listing as soon as you save.</p>
      </section>
      <NewEventForm knownTags={tags} />
    </div>
  )
}
