export function notFound(req, _res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`)
  error.statusCode = 404
  next(error)
}

export function errorHandler(error, _req, res, _next) {
  const status = error.statusCode || 500
  const body = {
    success: false,
    message: status >= 500 ? 'Internal server error' : error.message,
  }

  if (error.details) body.details = error.details
  if (status >= 500) console.error(error)

  res.status(status).json(body)
}
