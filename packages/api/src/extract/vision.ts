import { extractionSchema, type Extraction, type ExtractImageType } from '@open-event-db/shared'

export interface ExtractImage {
  data: Buffer
  type: ExtractImageType
}

export interface VisionExtractor {
  extract(image: ExtractImage): Promise<Extraction>
}

export type ExtractionErrorKind = 'unavailable' | 'provider' | 'timeout' | 'invalid_output'

export class ExtractionError extends Error {
  constructor(
    public kind: ExtractionErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'ExtractionError'
  }
}

const isTestRun = !!process.env.VITEST || process.env.NODE_ENV === 'test'

/*
 * No "today" in the prompt on purpose: the model reports dates exactly as written and the API resolves
 * years and relative weekdays itself (normalize.ts). Knowing the date would invite the model to turn
 * "tonight" or "this Saturday" into a date, which the PRD rules out.
 */
export const SYSTEM_PROMPT = `You read event flyers and screenshots of event posts (Instagram, Facebook, Resident Advisor, Telegram and others) and extract the details of ONE event as JSON.

General rules:
- Extract only what is visibly written. Never guess or invent. Use null, or an empty list, for anything that is not shown.
- If the image shows several events, extract only the most prominent one.
- Ignore platform UI: like/interested/going counts, comments and commenter names, ads, buttons, neighbouring posts.

Fields:
- title: the event's name. On flyers it is usually the largest or most stylised lettering, not a slogan or tagline describing the party. Not the venue name, and not the poster's account name unless it is clearly the event name. Never put the event name into venue_name.
- date: only an explicit calendar date such as "17.10.", "Sa 17 Okt", "Sat, Oct 17" or "17/10/2026". Report day and month as numbers, year only if it is written (otherwise null; two-digit years as written), and weekday (mon … sun) only if it is written next to the date. Numeric dates are day-month order unless the source is clearly American. Relative expressions are NOT dates: "tonight", "today", "tomorrow", "this Saturday", "next week", "in 3 days" → date = null.
- start_time, end_time: 24-hour "HH:MM" ("23h" → "23:00", "11pm" → "23:00"). "Open end", "till late" or similar → end_time = null.
- end_date: only when an explicit, different end date is written (e.g. a festival "17.–19.10."). For a night like "23:00–06:00" leave end_date null.
- venue_name: the venue, club or location name.
- address: street, house number and postal code as shown, e.g. "Dunckerstraße 64, 10439". No city or country in this field.
- city: only the city name if shown, e.g. "Berlin" — no postal code, no country.
- description: one or two sentences, at most about 200 characters, saying what the event is, in your own words. Never copy sentences from the image. Write it in the language of the event's own text (the flyer, post or event description), not the language of the platform's buttons and menus: German event text → German, English event text → English. Leave out lineup, date and venue.
- lineup: performer, artist and DJ names, one act per entry. Keep country codes written next to a name ("Lavion FR"), but leave out section labels such as "DJs:", "Live:" or "Line-up:".
- tags: up to five lowercase genre or format keywords that are shown or clearly stated, e.g. "techno", "house", "queer", "open air", "concert", "workshop".
- links: shop and ticket pages are kind "tickets". Only URLs and handles that are literally written in the image, each with a kind. Never build or guess a URL from the event, venue or platform name — if no URL is written, return an empty list. The page's own address counts only if a browser address bar is visible. Write full URLs. An Instagram handle "@name" becomes "https://www.instagram.com/name".`

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })
const nullableString = { type: ['string', 'null'] }

const writtenDate = nullable({
  type: 'object',
  additionalProperties: false,
  required: ['day', 'month', 'year', 'weekday'],
  properties: {
    day: { type: 'integer' },
    month: { type: 'integer' },
    year: { type: ['integer', 'null'] },
    weekday: { type: ['string', 'null'], enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', null] },
  },
})

/** JSON Schema twin of `extractionSchema` for structured output (strict mode: every key required). */
export const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(extractionSchema.shape),
  properties: {
    title: nullableString,
    date: writtenDate,
    start_time: nullableString,
    end_date: writtenDate,
    end_time: nullableString,
    venue_name: nullableString,
    address: nullableString,
    city: nullableString,
    description: nullableString,
    lineup: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'url'],
        properties: {
          kind: {
            type: 'string',
            enum: ['tickets', 'instagram', 'facebook', 'resident_advisor', 'telegram', 'soundcloud', 'bandcamp', 'website'],
          },
          url: { type: 'string' },
        },
      },
    },
  },
} as const

export interface ScalewayVisionConfig {
  secretKey: string
  projectId: string
  model: string
  timeoutMs?: number
}

/** Scaleway Generative APIs (OpenAI-compatible chat completions with image input). */
export function scalewayVision(config: ScalewayVisionConfig): VisionExtractor {
  const endpoint = `https://api.scaleway.ai/${config.projectId}/v1/chat/completions`

  return {
    async extract(image) {
      let res: Response
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.secretKey}` },
          signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
          body: JSON.stringify({
            model: config.model,
            temperature: 0,
            max_tokens: 2000,
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'event_extraction', strict: true, schema: EXTRACTION_JSON_SCHEMA },
            },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Extract the event from this image.' },
                  { type: 'image_url', image_url: { url: `data:${image.type};base64,${image.data.toString('base64')}` } },
                ],
              },
            ],
          }),
        })
      } catch (err) {
        if (err instanceof DOMException && err.name === 'TimeoutError') {
          throw new ExtractionError('timeout', 'Vision model did not answer in time')
        }
        throw new ExtractionError('provider', `Vision request failed: ${(err as Error).message}`)
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new ExtractionError('provider', `Scaleway responded ${res.status}: ${detail.slice(0, 500)}`)
      }

      const json = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null
      const content = json?.choices?.[0]?.message?.content
      if (!content) throw new ExtractionError('invalid_output', 'Vision model returned no content')

      let parsed: unknown
      try {
        // Some models wrap JSON in a code fence even in structured-output mode
        parsed = JSON.parse(content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''))
      } catch {
        throw new ExtractionError('invalid_output', 'Vision model returned invalid JSON')
      }
      const result = extractionSchema.safeParse(parsed)
      if (!result.success) {
        throw new ExtractionError('invalid_output', `Vision output failed validation: ${result.error.message.slice(0, 500)}`)
      }
      return result.data
    },
  }
}

const unavailable: VisionExtractor = {
  async extract() {
    throw new ExtractionError('unavailable', 'Image import is not configured on this server')
  },
}

function extractorFromEnv(): VisionExtractor {
  // Automated tests never call the real provider; they install a stub via vision.setExtractor().
  if (isTestRun) return unavailable
  const { SCALEWAY_SECRET_KEY, SCALEWAY_PROJECT_ID, VISION_MODEL } = process.env
  if (!SCALEWAY_SECRET_KEY || !SCALEWAY_PROJECT_ID || !VISION_MODEL) return unavailable
  return scalewayVision({ secretKey: SCALEWAY_SECRET_KEY, projectId: SCALEWAY_PROJECT_ID, model: VISION_MODEL })
}

const defaultExtractor = extractorFromEnv()
let extractor: VisionExtractor = defaultExtractor

export const vision = {
  get extractor(): VisionExtractor {
    return extractor
  },
  setExtractor(e: VisionExtractor) {
    extractor = e
  },
  reset() {
    extractor = defaultExtractor
  },
}
