import { z } from 'zod'
import { sanitizeLineup, type Lineup } from '@open-event-db/shared'
import { ExtractionError, callScalewayJson, isTestRun, type ScalewayConfig } from './vision.js'

export interface LineupReader {
  /** The lineup the text names, already checked against the text (`checkAgainstText`) and sanitized. */
  read(text: string): Promise<Lineup>
}

export const LINEUP_SYSTEM_PROMPT = `You read the text of an event announcement and extract its lineup as JSON: the performers, bands and DJs who play at this event.

Rules:
- One act per performer, band or DJ, with the name spelled exactly as written. A back-to-back pair stays one act ("A b2b B").
- live: true when the text marks the act as live ("(live)", "live:", a "Live" section) or it is a band in a concert listing; otherwise false.
- note: a label, crew, collective or origin written right next to the name, e.g. "Young And Cold" from "Bragolin (live) [Young And Cold]", "eisengrau" from "paura diamante (eisengrau)", "FR" from "Lavion FR". Otherwise null.
- time: only a set time written next to the act, as "HH:MM". Otherwise null.
- Groups: only when the text names them, such as floors or rooms, or sections like "Live" and "DJs". Otherwise put all acts into one group with name null.
- These are NOT acts: organisers and presenters ("aufnahme + wiedergabe presents"), the event or series name, resident crews named after the event ("Factory DJs"), labels on their own, venues, and names that appear only in prose about history, influences, tours or past releases.
- If the text names no acts, answer {"groups": []}. Never guess or invent a name.

Example: "on decks: ▷ Uwe Marx ▷ Marko König" → {"groups": [{"name": null, "acts": [{"name": "Uwe Marx", "time": null, "live": false, "note": null}, {"name": "Marko König", "time": null, "live": false, "note": null}]}]}`

const nullableString = { type: ['string', 'null'] }

const LINEUP_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'acts'],
        properties: {
          name: nullableString,
          acts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'time', 'live', 'note'],
              properties: { name: { type: 'string' }, time: nullableString, live: { type: 'boolean' }, note: nullableString },
            },
          },
        },
      },
    },
  },
} as const

// Plain strings: a name over the field limits must not fail the call, sanitizeLineup clips it afterwards
const modelLineupSchema = z.object({
  groups: z.array(
    z.object({
      name: z.string().nullable(),
      acts: z.array(z.object({ name: z.string(), time: z.string().nullable(), live: z.boolean(), note: z.string().nullable() })),
    }),
  ),
})

/** How names are compared with the text: case, whitespace and Markdown/list marks don't count. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[*_[\]▷#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Keeps only what the text actually says: acts whose name is not in it are dropped, notes and group names
 * that are not in it are cleared. Then sanitized like every other lineup (limits, times, empty groups).
 */
export function checkAgainstText(lineup: Lineup, text: string): Lineup {
  const haystack = normalizeForMatch(text)
  const inText = (value: string | null) => {
    const needle = value === null ? '' : normalizeForMatch(value)
    return needle !== '' && haystack.includes(needle)
  }
  return sanitizeLineup(
    lineup.map((group) => ({
      name: inText(group.name) ? group.name : null,
      acts: group.acts
        .filter((act) => inText(act.name))
        .map((act) => ({ ...act, note: inText(act.note) ? act.note : null })),
    })),
  )
}

/** Scaleway Generative APIs with the announcement text as the user message. */
export function scalewayLineup(config: ScalewayConfig): LineupReader {
  return {
    async read(text) {
      const { groups } = await callScalewayJson(
        config,
        [
          { role: 'system', content: LINEUP_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        { label: 'Lineup', schemaName: 'lineup', jsonSchema: LINEUP_JSON_SCHEMA, parse: modelLineupSchema, maxTokens: 4000 },
      )
      return checkAgainstText(groups, text)
    },
  }
}

const unavailable: LineupReader = {
  async read() {
    throw new ExtractionError('unavailable', 'Lineup reading is not configured on this server')
  },
}

function readerFromEnv(): LineupReader {
  // Automated tests never call the real provider; they install a stub via lineupReading.setReader().
  if (isTestRun) return unavailable
  const { SCALEWAY_SECRET_KEY, SCALEWAY_PROJECT_ID, TEXT_MODEL, VISION_MODEL } = process.env
  const model = TEXT_MODEL || VISION_MODEL // an empty TEXT_MODEL counts as unset
  if (!SCALEWAY_SECRET_KEY || !SCALEWAY_PROJECT_ID || !model) return unavailable
  return scalewayLineup({ secretKey: SCALEWAY_SECRET_KEY, projectId: SCALEWAY_PROJECT_ID, model })
}

const defaultReader = readerFromEnv()
let reader: LineupReader = defaultReader

export const lineupReading = {
  get reader(): LineupReader {
    return reader
  },
  setReader(r: LineupReader) {
    reader = r
  },
  reset() {
    reader = defaultReader
  },
}
