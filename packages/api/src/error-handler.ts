import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { ApiError } from './errors.js'

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

  req.log.error({ err }, 'unhandled error')
  reply.status(500).send({
    error: { code: 'internal_error', message: 'Internal server error' },
  })
}
