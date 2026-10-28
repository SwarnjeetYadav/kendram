import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { env } from '../config/env.js'
import { ApiError } from '../utils/apiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { postgresAuthUserById } from '../services/postgresAuth.service.js'

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')

  if (scheme !== 'Bearer' || !token) throw new ApiError(401, 'Authentication required')

  let payload
  try {
    payload = jwt.verify(token, env.jwtSecret)
  } catch {
    throw new ApiError(401, 'Invalid or expired access token')
  }

  if (process.env.POSTGRES_AUTH_ENABLED === 'true') {
    const user = await postgresAuthUserById(payload.sub)
    if (!user) throw new ApiError(401, 'User account is not active')
    req.user = { id: user.legacy_mongo_id || user.id, name: user.name, email: user.email, role: user.role, displayName: user.display_name || '', avatarUrl: user.avatar_url || '', bio: user.bio || '', location: user.location || '', timezone: user.timezone || 'Asia/Kolkata' }
    return next()
  }
  const user = await User.findById(payload.sub).lean()
  if (!user || user.status !== 'ACTIVE') throw new ApiError(401, 'User account is not active')

  req.user = {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    displayName: user.displayName || '', avatarUrl: user.avatarUrl || '', bio: user.bio || '', location: user.location || '', timezone: user.timezone || 'Asia/Kolkata',
  }

  next()
})

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user.role)) return next(new ApiError(403, 'You do not have permission for this action'))
    next()
  }
}
