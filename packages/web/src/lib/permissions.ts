import type { AccountMe, EventDetail } from '@open-event-db/shared'
import type { PermissionActor, PermissionEvent } from '@open-event-db/shared'

/** The shared permission rules take organizer ids under `organizer_id`; the API's event detail calls them `id`. */
export function permissionEvent(event: Pick<EventDetail, 'organizers'>): PermissionEvent {
  return { organizers: event.organizers.map((o) => ({ organizer_id: o.id, role: o.role })) }
}

/** Only verified organizers carry rights. */
export function permissionActor(me: Pick<AccountMe, 'id' | 'is_scout' | 'organizers'>): PermissionActor {
  return { id: me.id, is_scout: me.is_scout, organizer_ids: me.organizers.filter((o) => o.verified).map((o) => o.id) }
}

/** Creating events needs a scout or a member of at least one verified organizer. */
export function canCreateEvents(me: Pick<AccountMe, 'is_scout' | 'organizers'> | null): boolean {
  return !!me && (me.is_scout || me.organizers.some((o) => o.verified))
}

/** Everyone else who finished onboarding may suggest events; the team reviews them. */
export function canSuggestEvents(
  me: Pick<AccountMe, 'onboarded' | 'is_scout' | 'organizers'> | null,
): boolean {
  return !!me && me.onboarded && !canCreateEvents(me)
}
