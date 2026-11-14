import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTags } from '@/lib/api'
import { getCurrentAccount } from '@/lib/session'
import { NewEventForm } from '@/components/NewEventForm'
import type { PublishAsOption } from '@/components/EventForm'
import { canSuggestEvents } from '@/lib/permissions'
import { Headline } from '@/components/Headline'

export const metadata: Metadata = { title: 'Create or suggest event' }

export default async function NewEventPage() {
  const me = await getCurrentAccount()
  if (!me) redirect('/login?return_to=/events/new')

  const tags = await getTags()

  // Scouts default to adding events without an organizer; everyone else publishes as one of their verified organizers
  const organizerOptions: PublishAsOption[] = me.organizers
    .filter((o) => o.verified)
    .map((o) => ({ value: o.id, label: o.name }))
  const scoutOption: PublishAsOption = { value: '', label: 'As scout, without organizer' }
  const publishAs = me.is_scout ? [scoutOption, ...organizerOptions] : organizerOptions

  // Everyone else who finished onboarding suggests; the team reviews it before it goes live
  if (publishAs.length === 0 && canSuggestEvents(me)) {
    return (
      <div className="kk-container kk-container--narrow">
        <section className="kk-intro" style={{ gap: 12 }}>
          <p className="kk-eyebrow">New event</p>
          <Headline text="Suggest event" narrow />
          <p className="kk-lede max-w-none">
            Know about an event that’s missing? Tell us. You can import it from a flyer or type it in.
          </p>
        </section>
        <NewEventForm knownTags={tags} publishAs={[]} suggest />
      </div>
    )
  }

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
          You can’t create events yet.
        </div>
      ) : (
        <NewEventForm knownTags={tags} publishAs={publishAs} />
      )}
    </div>
  )
}
