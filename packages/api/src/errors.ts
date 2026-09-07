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
export const badRequest = (message: string) => new ApiError(400, 'bad_request', message)
