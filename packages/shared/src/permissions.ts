import type { EventOrganizerRole } from './events.js'

/**
 * Event permissions, shared by the API and the web app so the rules can't drift.
 *
 * An event without organizers is unclaimed (added by a scout): any scout may edit and cancel it.
 * Once claimed, only members of its organizers may edit, and only members of the creator organizer
 * may cancel or manage co-hosts.
 */

export interface PermissionEvent {
  organizers: readonly { organizer_id: string; role: EventOrganizerRole }[]
}

export interface PermissionActor {
  id: string
  is_scout: boolean
  /** Ids of the verified organizers the account belongs to. */
  organizer_ids: readonly string[]
}

export const isClaimed = (event: PermissionEvent) => event.organizers.length > 0

/** The actor's strongest role on the event through any of their organizers; creator wins. */
export function actorRole(event: PermissionEvent, actor: PermissionActor): EventOrganizerRole | null {
  const mine = event.organizers.filter((o) => actor.organizer_ids.includes(o.organizer_id))
  if (mine.some((o) => o.role === 'creator')) return 'creator'
  if (mine.some((o) => o.role === 'co_host')) return 'co_host'
  return null
}

export function canEdit(event: PermissionEvent, actor: PermissionActor): boolean {
  if (!isClaimed(event)) return actor.is_scout
  return actorRole(event, actor) !== null
}

export function canCancel(event: PermissionEvent, actor: PermissionActor): boolean {
  if (!isClaimed(event)) return actor.is_scout
  return actorRole(event, actor) === 'creator'
}

/** Unclaimed events have no organizers to manage; they gain them only through a claim. */
export function canManageOrganizers(event: PermissionEvent, actor: PermissionActor): boolean {
  return actorRole(event, actor) === 'creator'
}
