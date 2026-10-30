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

/**
 * The same lineup with its keys in one order. Postgres jsonb reorders object keys, so a lineup read back
 * from the database only compares equal (JSON.stringify) to one from a draft in this form.
 */
export function canonicalLineup(lineup: Lineup): Lineup {
  return lineup.map((g) => ({
    name: g.name,
    acts: g.acts.map((a) => ({ name: a.name, time: a.time, live: a.live, note: a.note })),
  }))
}

const clip = (s: string | null | undefined, max: number) => {
  const t = s?.trim() ?? ''
  return t ? t.slice(0, max) : null
}

/** "0:30" → "00:30"; anything that is still not a time on a 24-hour clock becomes null. */
function cleanTime(time: string | null | undefined): string | null {
  const m = time?.trim().match(/^(\d{1,2})[:.](\d{2})$/)
  const padded = m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null
  return padded && /^([01]\d|2[0-3]):[0-5]\d$/.test(padded) ? padded : null
}

/**
 * A lineup read from a source page made valid: names and notes cut to length, odd times dropped, acts
 * without a name and groups left empty removed, then capped. One odd act must not fail the whole source.
 */
export function sanitizeLineup(lineup: Lineup): Lineup {
  const groups = lineup
    .map((g) => ({
      name: clip(g.name, 100),
      acts: g.acts.flatMap((a) => {
        const name = clip(a.name, 200)
        return name ? [{ name, time: cleanTime(a.time), live: a.live === true, note: clip(a.note, 200) }] : []
      }),
    }))
    .filter((g) => g.acts.length > 0)
  return capLineup(groups)
}

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
