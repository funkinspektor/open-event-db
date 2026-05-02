import { createDb } from './index.js'
import {
  events,
  eventOwners,
  publishers,
  venues,
} from './schema.js'

const url = process.env.DATABASE_URL ?? 'postgres://oedb:oedb@localhost:5432/oedb'
const db = createDb(url)

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
    links: { website: 'https://letztewelle.example', instagram: 'https://instagram.com/letztewelle' },
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

const [event] = await db
  .insert(events)
  .values({
    title: 'Letzte Welle x Nachtagentur',
    description: 'A long night of warehouse techno.',
    startsAt: new Date('2026-06-13T22:00:00Z'),
    endsAt: new Date('2026-06-14T10:00:00Z'),
    venueId: rso.id,
    city: 'Berlin',
    tags: ['techno', 'warehouse'],
    links: { ra: 'https://ra.co/events/example' },
    createdBy: alice.id,
  })
  .returning()

if (!event) throw new Error('failed to insert seed event')

await db.insert(eventOwners).values([
  { eventId: event.id, publisherId: alice.id, role: 'creator' },
  { eventId: event.id, publisherId: bob.id, role: 'co_owner' },
])

console.log('Seed complete:')
console.log(`  publishers: ${alice.slug}, ${bob.slug}`)
console.log(`  venue: ${rso.name} (${rso.city})`)
console.log(`  event: ${event.title} on ${event.startsAt.toISOString()}`)

process.exit(0)
