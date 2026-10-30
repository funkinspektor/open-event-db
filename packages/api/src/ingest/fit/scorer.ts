import { z } from 'zod'
import { ingestFitVerdictSchema } from '@open-event-db/shared'
import { callScalewayJson, isTestRun, type ScalewayConfig } from '../../extract/vision.js'

export const fitJudgementSchema = z.object({
  verdict: ingestFitVerdictSchema,
  reason: z.string().transform((s) => s.trim().slice(0, 200)),
})

export type FitJudgement = z.infer<typeof fitJudgementSchema>

export interface FitScorer {
  score(prompt: { system: string; user: string }): Promise<FitJudgement>
}

const FIT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reason'],
  properties: {
    verdict: { type: 'string', enum: ingestFitVerdictSchema.options },
    reason: { type: 'string' },
  },
} as const

/** Scaleway Generative APIs; throws `ExtractionError` like the extractors do. */
export function scalewayFit(config: ScalewayConfig): FitScorer {
  return {
    score(prompt) {
      return callScalewayJson(
        config,
        [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        { label: 'Fit', schemaName: 'fit_judgement', jsonSchema: FIT_JSON_SCHEMA, parse: fitJudgementSchema, maxTokens: 200 },
      )
    },
  }
}

function scorerFromEnv(): FitScorer | null {
  // Automated tests never call the real provider; they install a stub via fitScoring.setScorer().
  if (isTestRun) return null
  const { SCALEWAY_SECRET_KEY, SCALEWAY_PROJECT_ID, TEXT_MODEL, VISION_MODEL } = process.env
  const model = TEXT_MODEL || VISION_MODEL // an empty TEXT_MODEL counts as unset
  if (!SCALEWAY_SECRET_KEY || !SCALEWAY_PROJECT_ID || !model) return null
  return scalewayFit({ secretKey: SCALEWAY_SECRET_KEY, projectId: SCALEWAY_PROJECT_ID, model })
}

const defaultScorer = scorerFromEnv()
let scorer: FitScorer | null = defaultScorer

export const fitScoring = {
  get scorer(): FitScorer | null {
    return scorer
  },
  setScorer(s: FitScorer | null) {
    scorer = s
  },
  reset() {
    scorer = defaultScorer
  },
}
