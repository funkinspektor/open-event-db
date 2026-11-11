import { z } from 'zod'
import { slugSchema } from './organizers.js'

/** An account's handle follows the slug format. */
export const handleSchema = slugSchema

export const organizerMemberRoleSchema = z.enum(['owner', 'member'])
export type OrganizerMemberRole = z.infer<typeof organizerMemberRoleSchema>

export const accountMembershipSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  role: organizerMemberRoleSchema,
  verified: z.boolean(),
})

export type AccountMembership = z.infer<typeof accountMembershipSchema>

export const accountMeSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  handle: z.string(),
  display_name: z.string(),
  is_scout: z.boolean(),
  has_api_key: z.boolean(),
  auth_method: z.enum(['api_key', 'session']),
  organizers: z.array(accountMembershipSchema),
})

export type AccountMe = z.infer<typeof accountMeSchema>

export const accountUpdateSchema = z
  .object({
    handle: handleSchema,
    display_name: z.string().trim().min(1).max(200),
  })
  .partial()

export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>

export const checkHandleQuerySchema = z.object({
  handle: handleSchema,
})

export const apiKeyResponseSchema = z.object({
  data: z.object({ api_key: z.string() }),
})

export const magicLinkRequestSchema = z.object({
  email: z.string().trim().email(),
})
