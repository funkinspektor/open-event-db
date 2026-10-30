import { createHash } from 'node:crypto'
import type { IngestDraft } from '@open-event-db/shared'
import { TASTE } from './taste.js'

export const FIT_SYSTEM_PROMPT = `You help the editors of Kellerkompass, a curated event guide for one subculture, decide which events from venue feeds belong in the guide.

What belongs:
${TASTE}

Judge ONE event and answer with JSON {"verdict": ..., "reason": ...}:
- "fit": clearly part of this scene.
- "maybe": unsure, or the information is not enough to judge.
- "no": clearly outside this scene.
When in doubt, answer "maybe": wrongly filtering out a scene event costs more than one extra event to review.
"reason" is one short English sentence (at most 140 characters) naming what decided it, e.g. the genre or the kind of event.
The editors' recent decisions follow as examples of their taste; weigh them, but the description above comes first.`

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** Identifies the prompt wording and taste text; an item is re-scored when it changes. */
export const PROMPT_VERSION = sha256(FIT_SYSTEM_PROMPT).slice(0, 16)

/** What the model sees of one event. Key order is part of the fingerprint. */
export interface FitSubject {
  title: string
  place: string | null
  source: string
  starts_at: string
  categories: string[]
  description: string
}

export interface FitExamples {
  accepted: FitSubject[]
  rejected: FitSubject[]
}

const DESCRIPTION_LIMIT = 1500
const EXAMPLE_DESCRIPTION_LIMIT = 150

export function subjectOf(draft: IngestDraft, venueName: string | null, sourceName: string): FitSubject {
  return {
    title: draft.title,
    place: venueName ?? draft.location_text,
    source: sourceName,
    starts_at: draft.starts_at,
    categories: draft.categories,
    description: draft.description.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_LIMIT),
  }
}

/** The examples are not part of it: new editor decisions alone never trigger a re-score. */
export function fingerprint(subject: FitSubject): string {
  return sha256(`${PROMPT_VERSION}\n${JSON.stringify(subject)}`)
}

const exampleLine = (s: FitSubject) =>
  `- ${s.title} | ${s.place ?? 'unknown place'} | ${s.description.slice(0, EXAMPLE_DESCRIPTION_LIMIT)}`

export function buildPrompt(subject: FitSubject, examples: FitExamples): { system: string; user: string } {
  const sections = [FIT_SYSTEM_PROMPT]
  if (examples.accepted.length) {
    sections.push(`Recently accepted by the editors:\n${examples.accepted.map(exampleLine).join('\n')}`)
  }
  if (examples.rejected.length) {
    sections.push(`Recently rejected by the editors:\n${examples.rejected.map(exampleLine).join('\n')}`)
  }
  const user = [
    `Title: ${subject.title}`,
    `Place: ${subject.place ?? 'unknown'}`,
    `Source: ${subject.source}`,
    `Starts: ${subject.starts_at}`,
    `Categories: ${subject.categories.join(', ') || 'none'}`,
    `Description: ${subject.description || 'none'}`,
  ].join('\n')
  return { system: sections.join('\n\n'), user }
}
