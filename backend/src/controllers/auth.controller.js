import { asyncHandler } from '../utils/asyncHandler.js'
import { loginUser, registerUser, verifyEmailAddress, resendVerificationEmailForAddress, requestPasswordReset, resetPassword } from '../services/auth.service.js'
import User from '../models/User.js'
import { ApiError } from '../utils/apiError.js'
import { postgresRegister, postgresLogin, postgresVerifyEmail, postgresResendVerification, postgresRequestReset, postgresResetPassword, postgresUpdateProfile } from '../services/postgresAuth.service.js'
const postgresAuthEnabled = () => process.env.POSTGRES_AUTH_ENABLED === 'true'

export const register = asyncHandler(async (req, res) => {
  const result = postgresAuthEnabled() ? await postgresRegister(req.body) : await registerUser(req.body)
  res.status(201).json({ success: true, data: result })
})

export const login = asyncHandler(async (req, res) => {
  const result = postgresAuthEnabled() ? await postgresLogin(req.body) : await loginUser(req.body)
  res.json({ success: true, data: result })
})

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: req.user })
})

export const updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['name', 'displayName', 'avatarUrl', 'bio', 'location', 'timezone']
  const updates = {}
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(req.body, key)) {
    if (typeof req.body[key] !== 'string') throw new ApiError(400, key + ' must be text')
    updates[key] = req.body[key].trim()
  }
  if (Object.hasOwn(updates, 'name') && (!updates.name || updates.name.length > 80)) throw new ApiError(400, 'Full name is required and must be at most 80 characters')
  if (Object.hasOwn(updates, 'displayName') && updates.displayName.length > 50) throw new ApiError(400, 'Display name must be at most 50 characters')
  if (Object.hasOwn(updates, 'bio') && updates.bio.length > 240) throw new ApiError(400, 'Bio must be at most 240 characters')
  if (Object.hasOwn(updates, 'location') && updates.location.length > 80) throw new ApiError(400, 'Location must be at most 80 characters')
  if (Object.hasOwn(updates, 'avatarUrl') && updates.avatarUrl && !/^https:\/\//i.test(updates.avatarUrl)) throw new ApiError(400, 'Profile image must use a secure HTTPS URL')
  if (Object.hasOwn(updates, 'timezone') && updates.timezone.length > 80) throw new ApiError(400, 'Timezone must be at most 80 characters')
  if (postgresAuthEnabled()) return res.json({ success: true, data: await postgresUpdateProfile(req.user.id, updates) })
  const user = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true, runValidators: true }).lean()
  if (!user) throw new ApiError(404, 'Account not found')
  res.json({ success: true, data: { id: user._id, name: user.name, displayName: user.displayName || '', email: user.email, role: user.role, avatarUrl: user.avatarUrl || '', bio: user.bio || '', location: user.location || '', timezone: user.timezone || 'Asia/Kolkata', status: user.status } })
})

export const verifyEmail = asyncHandler(async (req,res)=>res.json({success:true,data:await (postgresAuthEnabled()?postgresVerifyEmail(req.body.token):verifyEmailAddress(req.body.token))}))
export const resendVerification = asyncHandler(async (req,res)=>res.json({success:true,data:await (postgresAuthEnabled()?postgresResendVerification(req.body.email):resendVerificationEmailForAddress(req.body.email))}))
export const forgotPassword = asyncHandler(async (req,res)=>res.json({success:true,data:await (postgresAuthEnabled()?postgresRequestReset(req.body.email):requestPasswordReset(req.body.email))}))
export const completePasswordReset = asyncHandler(async (req,res)=>res.json({success:true,data:await (postgresAuthEnabled()?postgresResetPassword(req.body.token,req.body.password):resetPassword(req.body.token,req.body.password))}))
