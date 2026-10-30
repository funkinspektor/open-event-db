import { z } from 'zod'

export const LINEUP_MAX_GROUPS = 20
export const LINEUP_MAX_ACTS = 200

/** One act as listed: the time is the venue's own ("01:00" after midnight), never sorted. */
export const lineupActSchema = z.object({
  name: z.string().trim().min(1).max(200),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM')
    .nullable()
    .default(null),
  live: z.boolean().default(false),
  /** Label, crew or country next to the name. */
  note: z.string().trim().max(200).nullable().default(null),
})

/** A floor, room or part of the night ("Live", "DJs"); null when the lineup has no groups. */
export const lineupGroupSchema = z.object({
  name: z.string().trim().max(100).nullable().default(null),
  acts: z.array(lineupActSchema).min(1).max(LINEUP_MAX_ACTS),
})

export const lineupSchema = z
  .array(lineupGroupSchema)
  .max(LINEUP_MAX_GROUPS)
  .superRefine((groups, ctx) => {
    const total = groups.reduce((n, g) => n + g.acts.length, 0)
    if (total > LINEUP_MAX_ACTS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A lineup has at most ${LINEUP_MAX_ACTS} acts (got ${total})` })
    }
  })

export type LineupAct = z.infer<typeof lineupActSchema>
export type LineupGroup = z.infer<typeof lineupGroupSchema>
export type Lineup = z.infer<typeof lineupSchema>

/** The first groups and acts within the limits, in order; a feed page with a huge lineup still makes a valid draft. */
export function capLineup(lineup: Lineup): Lineup {
  let left = LINEUP_MAX_ACTS
  const out: Lineup = []
  for (const group of lineup.slice(0, LINEUP_MAX_GROUPS)) {
    const acts = group.acts.slice(0, left)
    if (acts.length === 0) break
    out.push({ ...group, acts })
    left -= acts.length
  }
  return out
}
