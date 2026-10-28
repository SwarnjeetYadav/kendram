import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, name: user.name },
    env.jwtSecret,
    { expiresIn: '7d' },
  )
}
