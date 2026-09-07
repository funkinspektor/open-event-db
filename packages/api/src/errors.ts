export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message)
export const badRequest = (message: string, code = 'bad_request') => new ApiError(400, code, message)
export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'unauthorized', message)
export const forbidden = (message = 'Not allowed') => new ApiError(403, 'forbidden', message)
