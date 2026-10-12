import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { ApiError } from './errors.js'

const CLIENT_ERROR_CODES: Record<number, string> = {
  400: 'bad_request',
  404: 'not_found',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
}

export function errorHandler(
  err: FastifyError | Error,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  if (err instanceof ApiError) {
    reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return
  }

  if (err instanceof ZodError) {
    reply.status(400).send({
      error: {
        code: 'validation_error',
        message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      },
    })
    return
  }

  if ('statusCode' in err && err.statusCode === 429) {
    reply.status(429).send({
      error: { code: 'rate_limited', message: err.message ?? 'Too many requests' },
    })
    return
  }

  if ('validation' in err && err.validation) {
    reply.status(400).send({
      error: { code: 'validation_error', message: err.message ?? 'Validation failed' },
    })
    return
  }

  // Fastify's own client errors: malformed JSON, empty body, too large, unsupported Content-Type
  if ('statusCode' in err && err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    reply.status(err.statusCode).send({
      error: { code: CLIENT_ERROR_CODES[err.statusCode] ?? 'bad_request', message: err.message },
    })
    return
  }

  req.log.error({ err }, 'unhandled error')
  reply.status(500).send({
    error: { code: 'internal_error', message: 'Internal server error' },
  })
}
