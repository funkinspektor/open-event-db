import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  EXTRACT_DAILY_LIMIT,
  EXTRACT_IMAGE_TYPES,
  EXTRACT_MAX_BYTES,
  EXTRACT_MAX_IMAGES,
  type ExtractImageType,
} from '@open-event-db/shared'
import { ApiError } from '../errors.js'
import { requireAuth } from '../auth.js'
import { isEmptyDraft, normalizeExtraction } from '../extract/normalize.js'
import { ExtractionError, vision, type ExtractImage, type ExtractionErrorKind } from '../extract/vision.js'

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

const notAnImage = () =>
  new ApiError(415, 'unsupported_media_type', 'Send PNG, JPEG or WEBP images, as the request body or as multipart parts named "image"')

/** One image as the raw body, or 1–12 multipart parts named `image` (in the order sent to the model). */
async function imagesFromBody(body: unknown): Promise<ExtractImage[]> {
  if (Buffer.isBuffer(body)) {
    const type = sniffImageType(body)
    if (!type) throw notAnImage()
    return [{ data: body, type }]
  }
  if (!(body instanceof FormData)) throw notAnImage()

  const parts = body.getAll('image')
  if (parts.length === 0) throw new ApiError(400, 'no_images', 'Send at least one multipart part named "image"')
  if (parts.length > EXTRACT_MAX_IMAGES) {
    throw new ApiError(400, 'too_many_images', `Send at most ${EXTRACT_MAX_IMAGES} images per request`)
  }
  return Promise.all(
    parts.map(async (part) => {
      if (typeof part === 'string') throw notAnImage()
      const data = Buffer.from(await part.arrayBuffer())
      const type = sniffImageType(data)
      if (!type) throw notAnImage()
      return { data, type }
    }),
  )
}

const failures: Record<ExtractionErrorKind, [number, string, string]> = {
  unavailable: [503, 'extraction_unavailable', 'Image import is not available right now'],
  timeout: [504, 'extraction_timeout', 'Reading the image took too long'],
  provider: [502, 'extraction_provider_error', 'The image could not be read right now'],
  invalid_output: [422, 'extraction_failed', 'The image could not be read'],
}

export async function extractRoutes(app: FastifyInstance) {
  // Raw image body or multipart; the buffers live only for this request and are never written anywhere.
  app.addContentTypeParser(
    [...EXTRACT_IMAGE_TYPES],
    { parseAs: 'buffer', bodyLimit: EXTRACT_MAX_BYTES },
    (_req, body, done) => done(null, body),
  )
  // The whole body is in memory anyway (6 MiB cap), so the built-in multipart parser of fetch is enough
  app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer', bodyLimit: EXTRACT_MAX_BYTES }, async (req: FastifyRequest, body: Buffer) => {
    try {
      return await new Response(body, { headers: { 'content-type': req.headers['content-type'] ?? '' } }).formData()
    } catch {
      throw new ApiError(400, 'bad_request', 'Malformed multipart body')
    }
  })

  app.post(
    '/events/extract',
    { onRequest: requireAuth, bodyLimit: EXTRACT_MAX_BYTES, config: { rateLimit: extractRateLimit } },
    async (req) => {
      const images = await imagesFromBody(req.body)

      let extraction
      try {
        extraction = await vision.extractor.extract(images)
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
