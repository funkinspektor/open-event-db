import { createDb } from './index.js'
import { events, eventOwners, publishers, venues } from './schema.js'

const url = process.env.DATABASE_URL ?? 'postgres://oedb:oedb@localhost:5432/oedb'
const db = createDb(url)

const DAY = 24 * 60 * 60 * 1000

function at(daysAhead: number, utcHour: number, minute = 0): Date {
  const d = new Date()
  d.setUTCHours(utcHour, minute, 0, 0)
  return new Date(d.getTime() + daysAhead * DAY)
}

// days until the next Friday (1–7), so recurring "Friday" seed events land on a real Friday
const toFriday = ((5 - new Date().getUTCDay() + 7) % 7) || 7

await db.delete(eventOwners)
await db.delete(events)
await db.delete(venues)
await db.delete(publishers)

const [alice] = await db
  .insert(publishers)
  .values({
    name: 'Letzte Welle',
    slug: 'letzte-welle',
    email: 'letzte.welle@example.com',
    verified: true,
    links: {
      website: 'https://letztewelle.example',
      instagram: 'https://instagram.com/letztewelle',
    },
  })
  .returning()
if (!alice) throw new Error('failed to insert seed publisher')

const [bob] = await db
  .insert(publishers)
  .values({
    name: 'Nachtagentur',
    slug: 'nachtagentur',
    email: 'crew@nachtagentur.example',
    verified: true,
    invitedBy: alice.id,
    links: { telegram: 'https://t.me/nachtagentur' },
  })
  .returning()
if (!bob) throw new Error('failed to insert seed publisher')

const [rso] = await db
  .insert(venues)
  .values({
    name: 'RSO',
    address: 'Schnellerstraße 137, 12439 Berlin',
    city: 'Berlin',
    coordinates: [13.487, 52.473],
    links: { website: 'https://rso.berlin', maps: 'https://maps.app.goo.gl/example' },
  })
  .returning()
if (!rso) throw new Error('failed to insert seed venue')

const [blank] = await db
  .insert(venues)
  .values({
    name: 'about blank',
    address: 'Markgrafendamm 24c, 10245 Berlin',
    city: 'Berlin',
    coordinates: [13.4695, 52.5045],
    links: { website: 'https://aboutblank.li' },
  })
  .returning()
if (!blank) throw new Error('failed to insert seed venue')

type Seed = {
  title: string
  description: string
  startsAt: Date
  endsAt: Date | null
  venueId?: string
  locationText?: string
  tags: string[]
  links?: Record<string, string>
  status?: 'scheduled' | 'postponed' | 'cancelled'
  recurrence?: string
  creator: string
  coOwners?: string[]
}

const seeds: Seed[] = [
  {
    title: 'Ambient Sessions at the Field',
    description:
      'Bring a blanket. Four hours of slow, beatless music as the sun goes down over Tempelhofer Feld. Free entry, donations welcome.',
    startsAt: at(1, 16),
    endsAt: at(1, 20),
    locationText: 'Tempelhofer Feld, Eingang Oderstraße',
    tags: ['ambient', 'open-air', 'free'],
    creator: alice.id,
  },
  {
    title: 'Friday Club Night',
    description:
      'Our weekly resident night. Straight-up techno from the local crew, no headliners, no guest list — just the room and the sound.',
    startsAt: at(toFriday, 21),
    endsAt: at(toFriday + 1, 6),
    venueId: rso.id,
    tags: ['techno', 'residents'],
    recurrence: 'FREQ=WEEKLY;BYDAY=FR',
    creator: alice.id,
  },
  {
    title: 'Sunday Open Air',
    description:
      'Garden opens at 14:00. House and disco outside until the neighbours complain, then we move indoors for the late shift.',
    startsAt: at(3, 12),
    endsAt: at(3, 22),
    venueId: blank.id,
    tags: ['open-air', 'house', 'disco'],
    links: { tickets: 'https://ra.co/events/example-open-air' },
    creator: bob.id,
  },
  {
    title: 'Queer Rave: Soft Power',
    description:
      'A rave by and for the queer community. Awareness team on site, no photos on the dancefloor, sliding-scale entry.',
    startsAt: at(5, 21),
    endsAt: at(6, 8),
    venueId: rso.id,
    tags: ['queer', 'techno', 'awareness'],
    links: { instagram: 'https://instagram.com/softpower.berlin' },
    status: 'postponed',
    creator: alice.id,
  },
  {
    title: 'Live: Modular Night',
    description:
      'Three live hardware sets, no laptops. Patch cables, happy accidents and a lot of low end.',
    startsAt: at(6, 20),
    endsAt: at(7, 2),
    venueId: blank.id,
    tags: ['live', 'electronic', 'modular'],
    status: 'cancelled',
    creator: bob.id,
    coOwners: [alice.id],
  },
  {
    title: 'Letzte Welle x Nachtagentur',
    description:
      'Two crews, one warehouse, twelve hours. Expect fast techno, a proper light show and a very late closing.',
    startsAt: at(9, 20),
    endsAt: at(10, 8),
    venueId: rso.id,
    tags: ['techno', 'warehouse'],
    links: { ra: 'https://ra.co/events/example' },
    creator: alice.id,
    coOwners: [bob.id],
  },
  {
    title: 'Day Party: Garden Edition',
    description: 'Daytime dancing, BBQ, and a kids-friendly hour from 15:00 to 16:00.',
    startsAt: at(12, 13),
    endsAt: at(12, 22),
    venueId: blank.id,
    tags: ['house', 'open-air', 'day'],
    creator: bob.id,
  },
  {
    title: 'Warehouse Weekender',
    description:
      'Friday to Sunday, two floors, forty artists. Weekend passes and single-night tickets available.',
    startsAt: at(16, 20),
    endsAt: at(18, 10),
    venueId: rso.id,
    tags: ['techno', 'warehouse', 'festival'],
    links: {
      ra: 'https://ra.co/events/example-weekender',
      tickets: 'https://tickets.example/weekender',
      facebook: 'https://facebook.com/events/example',
    },
    creator: alice.id,
    coOwners: [bob.id],
  },
  {
    title: 'Listening Session: New Releases',
    description:
      'Sit down, headphones off, big speakers on. We play upcoming releases from Berlin labels front to back.',
    startsAt: at(20, 18),
    endsAt: at(20, 21),
    locationText: 'Record store, address announced to ticket holders',
    tags: ['listening', 'ambient'],
    creator: bob.id,
  },
]

for (const s of seeds) {
  const [event] = await db
    .insert(events)
    .values({
      title: s.title,
      description: s.description,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      venueId: s.venueId ?? null,
      locationText: s.locationText ?? null,
      city: 'Berlin',
      tags: s.tags,
      links: s.links ?? {},
      status: s.status ?? 'scheduled',
      recurrence: s.recurrence ?? null,
      createdBy: s.creator,
    })
    .returning()
  if (!event) throw new Error(`failed to insert seed event ${s.title}`)

  await db.insert(eventOwners).values([
    { eventId: event.id, publisherId: s.creator, role: 'creator' },
    ...(s.coOwners ?? []).map((id) => ({
      eventId: event.id,
      publisherId: id,
      role: 'co_owner' as const,
    })),
  ])
}

console.log('Seed complete:')
console.log(`  publishers: ${alice.slug}, ${bob.slug}`)
console.log(`  venues: ${rso.name}, ${blank.name}`)
console.log(`  events: ${seeds.length}`)

process.exit(0)
