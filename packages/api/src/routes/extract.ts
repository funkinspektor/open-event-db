import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  EXTRACT_DAILY_LIMIT,
  EXTRACT_IMAGE_TYPES,
  EXTRACT_MAX_BYTES,
  type ExtractImageType,
} from '@open-event-db/shared'
import { ApiError } from '../errors.js'
import { requireAuth } from '../auth.js'
import { isEmptyDraft, normalizeExtraction } from '../extract/normalize.js'
import { ExtractionError, vision, type ExtractionErrorKind } from '../extract/vision.js'

// Per account, not per minute: this is a cost limit (PRD Event Capture, Decision 9)
const extractRateLimit = {
  max: EXTRACT_DAILY_LIMIT,
  timeWindow: '1 day',
  keyGenerator: (req: FastifyRequest) => `extract:${req.publisher?.id ?? req.ip}`,
}

/** The actual format, from the file signature — the Content-Type header is only a claim. */
function sniffImageType(data: Buffer): ExtractImageType | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return null
}

const failures: Record<ExtractionErrorKind, [number, string, string]> = {
  unavailable: [503, 'extraction_unavailable', 'Image import is not available right now'],
  timeout: [504, 'extraction_timeout', 'Reading the image took too long'],
  provider: [502, 'extraction_provider_error', 'The image could not be read right now'],
  invalid_output: [422, 'extraction_failed', 'The image could not be read'],
}

export async function extractRoutes(app: FastifyInstance) {
  // Raw image body; the buffer lives only for this request and is never written anywhere.
  app.addContentTypeParser(
    [...EXTRACT_IMAGE_TYPES],
    { parseAs: 'buffer', bodyLimit: EXTRACT_MAX_BYTES },
    (_req, body, done) => done(null, body),
  )

  app.post(
    '/events/extract',
    { onRequest: requireAuth, bodyLimit: EXTRACT_MAX_BYTES, config: { rateLimit: extractRateLimit } },
    async (req) => {
      const body = req.body
      const type = Buffer.isBuffer(body) ? sniffImageType(body) : null
      if (!Buffer.isBuffer(body) || !type) {
        throw new ApiError(415, 'unsupported_media_type', 'Send a PNG, JPEG or WEBP image as the request body')
      }

      let extraction
      try {
        extraction = await vision.extractor.extract({ data: body, type })
      } catch (err) {
        if (!(err instanceof ExtractionError)) throw err
        req.log.warn({ kind: err.kind, reason: err.message }, 'event extraction failed')
        const [status, code, message] = failures[err.kind]
        throw new ApiError(status, code, message)
      }

      const draft = normalizeExtraction(extraction, new Date())
      if (isEmptyDraft(draft)) throw new ApiError(422, 'nothing_extracted', 'No event details found in the image')
      return { data: draft }
    },
  )
}
