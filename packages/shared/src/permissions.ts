import type { EventOwnerRole } from './events.js'

/**
 * Event permissions, shared by the API and the web app so the rules can't drift.
 *
 * An event without owners is unclaimed (added by a scout): any scout may edit and cancel it.
 * Once claimed, only its owners may edit, and only the creator may cancel or manage co-owners.
 */

export interface PermissionEvent {
  owners: readonly { publisher_id: string; role: EventOwnerRole }[]
}

export interface PermissionActor {
  id: string
  is_scout: boolean
}

export const isClaimed = (event: PermissionEvent) => event.owners.length > 0

export function ownerRole(event: PermissionEvent, actor: PermissionActor): EventOwnerRole | null {
  return event.owners.find((o) => o.publisher_id === actor.id)?.role ?? null
}

export function canEdit(event: PermissionEvent, actor: PermissionActor): boolean {
  if (!isClaimed(event)) return actor.is_scout
  return ownerRole(event, actor) !== null
}

export function canCancel(event: PermissionEvent, actor: PermissionActor): boolean {
  if (!isClaimed(event)) return actor.is_scout
  return ownerRole(event, actor) === 'creator'
}

/** Unclaimed events have no owners to manage — they gain owners only through a claim. */
export function canManageOwners(event: PermissionEvent, actor: PermissionActor): boolean {
  return ownerRole(event, actor) === 'creator'
}
