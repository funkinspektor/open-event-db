import type { Extraction } from '@open-event-db/shared'
import { ExtractionError, SYSTEM_PROMPT, callScaleway, isTestRun, type ScalewayConfig } from './vision.js'

export interface TextExtractor {
  /** `text` is an event announcement, e.g. the description of a feed event. */
  extract(text: string): Promise<Extraction>
}

/** The image prompt, reworded for announcement text, so both stay one set of field rules. */
export const TEXT_SYSTEM_PROMPT = SYSTEM_PROMPT.replace(
  'event flyers and screenshots of event posts (Instagram, Facebook, Resident Advisor, Telegram and others)',
  'the text of an event announcement',
)
  .replace('If the image shows several events', 'If the text announces several events')
  .replace(' The page\'s own address counts only if a browser address bar is visible.', '')
  .replaceAll('the image', 'the text')

/** Scaleway Generative APIs with the announcement text as the user message. */
export function scalewayText(config: ScalewayConfig): TextExtractor {
  return {
    async extract(text) {
      return callScaleway(
        config,
        [
          { role: 'system', content: TEXT_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        'Text',
      )
    },
  }
}

const unavailable: TextExtractor = {
  async extract() {
    throw new ExtractionError('unavailable', 'Text extraction is not configured on this server')
  },
}

function extractorFromEnv(): TextExtractor {
  // Automated tests never call the real provider; they install a stub via textExtraction.setExtractor().
  if (isTestRun) return unavailable
  const { SCALEWAY_SECRET_KEY, SCALEWAY_PROJECT_ID, TEXT_MODEL, VISION_MODEL } = process.env
  const model = TEXT_MODEL || VISION_MODEL // an empty TEXT_MODEL counts as unset
  if (!SCALEWAY_SECRET_KEY || !SCALEWAY_PROJECT_ID || !model) return unavailable
  return scalewayText({ secretKey: SCALEWAY_SECRET_KEY, projectId: SCALEWAY_PROJECT_ID, model })
}

const defaultExtractor = extractorFromEnv()
let extractor: TextExtractor = defaultExtractor

export const textExtraction = {
  get extractor(): TextExtractor {
    return extractor
  },
  setExtractor(e: TextExtractor) {
    extractor = e
  },
  reset() {
    extractor = defaultExtractor
  },
}
