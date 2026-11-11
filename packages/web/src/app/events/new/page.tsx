import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTags } from '@/lib/api'
import { getCurrentAccount } from '@/lib/session'
import { NewEventForm } from '@/components/NewEventForm'
import type { PublishAsOption } from '@/components/EventForm'
import { Headline } from '@/components/Headline'

export const metadata: Metadata = { title: 'Create event' }

export default async function NewEventPage() {
  const me = await getCurrentAccount()
  if (!me) redirect('/login')

  const tags = await getTags()

  // Scouts default to adding events without an organizer; everyone else publishes as one of their verified organizers
  const organizerOptions: PublishAsOption[] = me.organizers
    .filter((o) => o.verified)
    .map((o) => ({ value: o.id, label: o.name }))
  const scoutOption: PublishAsOption = { value: '', label: 'As scout, without organizer' }
  const publishAs = me.is_scout ? [scoutOption, ...organizerOptions] : organizerOptions

  return (
    <div className="kk-container kk-container--narrow">
      <section className="kk-intro" style={{ gap: 12 }}>
        <p className="kk-eyebrow">New event</p>
        <Headline text="Create event" narrow />
        <p className="kk-lede max-w-none">
          {publishAs.length === 1 && !me.is_scout ? `Published as ${publishAs[0]!.label}. ` : ''}
          Live on the listing as soon as you save.
        </p>
      </section>
      {publishAs.length === 0 ? (
        <div className="kk-notice" role="status">
          You can’t create events yet: you need to belong to a verified organizer, or be a scout.
        </div>
      ) : (
        <NewEventForm knownTags={tags} publishAs={publishAs} />
      )}
    </div>
  )
}
